/**
 * Copyright (c) 2023 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { t } from "@app/locale"
import { Download as DownloadIcon, Operation, UploadFilled } from "@element-plus/icons-vue"
import { useManualRequest, useRequest, useState } from "@hooks"
import Flex from "@pages/components/Flex"
import processor from "@service/backup/processor"
import metaService from "@service/meta-service"
import { formatTime } from "@util/time"
import { downloadData } from "@api/aws"
import optionHolder from "@service/components/option-holder"
import statDatabase from "@db/stat-database"
import { ElButton, ElDivider, ElLoading, ElMessage, ElText } from "element-plus"
import { defineComponent, type StyleValue } from "vue"
import Clear from "./Clear"
import Download from "./Download"

async function handleTest() {
    const loading = ElLoading.service({ text: "Please wait...." })
    try {
        const { errorMsg } = await processor.checkAuth()
        if (!errorMsg) {
            ElMessage.success("Valid!")
        } else {
            ElMessage.error(errorMsg)
        }
    } finally {
        loading.close()
    }
}

async function handleManualFetch() {
    const loading = ElLoading.service({ text: "Fetching cloud data..." })
    try {
        const option = await optionHolder.get()
        const cid = await metaService.getCid()
        
        console.log('Client ID for download:', cid || 'No client ID (will download all data)')
        
        const awsAuth = option.backupAuths?.aws
        const awsExt = option.backupExts?.aws
        
        if (option.backupType !== 'aws' || !awsAuth || !awsExt?.apiEndpoint) {
            ElMessage.error("AWS sync not properly configured")
            return
        }

        console.log('Manual fetch using client ID:', cid)
        console.log('AWS config:', { 
            apiEndpoint: awsExt.apiEndpoint,
            region: awsExt.region || 'us-east-1',
            hasApiKey: !!awsAuth 
        })
        
        // Validate that we have all required parameters
        if (!awsAuth) {
            ElMessage.error("AWS API key not configured")
            return
        }
        if (!awsExt.apiEndpoint) {
            ElMessage.error("AWS API endpoint not configured")
            return
        }

        const awsConfig = {
            apiEndpoint: awsExt.apiEndpoint,
            websocketEndpoint: awsExt.websocketEndpoint || '',
            apiKey: awsAuth,
            region: awsExt.region || 'us-east-1'
        }

        // For private use, fetch ALL data (no date restrictions)
        console.log('Fetching ALL data from cloud (no date restrictions)')

        // For private use, download all data without client ID filtering
        // Pass cid for authentication header, but don't pass clientId in request to get ALL data
        const response = await downloadData(awsConfig, cid || 'anonymous', {
            // No startDate, endDate, or clientId to get ALL data
        })

        if (response.success) {
            console.log('Fetched cloud data:', response.data)
            
            // Merge downloaded data into local database
            if (response.data && response.data.length > 0) {
                const mergeResults = await mergeCloudDataToLocal(response.data)
                ElMessage.success(`Successfully merged ${mergeResults.merged} records (${mergeResults.updated} updated, ${mergeResults.added} new)`)
                console.log('Merge results:', mergeResults)
            } else {
                ElMessage.info('No data to merge - cloud storage is empty')
            }
        } else {
            ElMessage.error("Failed to fetch cloud data")
        }
    } catch (error) {
        console.error('Manual fetch error:', error)
        ElMessage.error(error instanceof Error ? error.message : 'Unknown error occurred')
    } finally {
        loading.close()
    }
}

/**
 * Merge downloaded cloud data into local database
 */
async function mergeCloudDataToLocal(cloudData: timer.core.Row[]): Promise<{
    merged: number
    added: number
    updated: number
    skipped: number
}> {
    let added = 0
    let updated = 0
    let skipped = 0
    
    console.log(`Starting merge of ${cloudData.length} cloud records`)
    
    for (const cloudRow of cloudData) {
        try {
            // Get existing local data for this host+date
            const existingRows = await statDatabase.select({ 
                keys: cloudRow.host,
                date: new Date(
                    parseInt(cloudRow.date.substring(0, 4)),
                    parseInt(cloudRow.date.substring(4, 6)) - 1,
                    parseInt(cloudRow.date.substring(6, 8))
                )
            })
            const existingRow = existingRows.length > 0 ? existingRows[0] : null
            
            if (!existingRow) {
                // No local data exists - add new record
                await statDatabase.forceUpdate({
                    host: cloudRow.host,
                    date: cloudRow.date,
                    focus: cloudRow.focus || 0,
                    time: cloudRow.time || 0,
                    run: cloudRow.run || 0
                })
                added++
                console.log(`Added new record: ${cloudRow.host} ${cloudRow.date}`)
            } else {
                // Local data exists - merge with conflict resolution
                const shouldUpdate = await resolveConflict(existingRow, cloudRow)
                
                if (shouldUpdate) {
                    // Merge the data (take maximum values approach)
                    const mergedRow: timer.core.Row = {
                        host: cloudRow.host,
                        date: cloudRow.date,
                        focus: Math.max(existingRow.focus || 0, cloudRow.focus || 0),
                        time: Math.max(existingRow.time || 0, cloudRow.time || 0),
                        run: Math.max(existingRow.run || 0, cloudRow.run || 0)
                    }
                    
                    await statDatabase.forceUpdate(mergedRow)
                    updated++
                    console.log(`Updated record: ${cloudRow.host} ${cloudRow.date} (focus: ${existingRow.focus || 0} -> ${mergedRow.focus}, time: ${existingRow.time || 0} -> ${mergedRow.time}, run: ${existingRow.run || 0} -> ${mergedRow.run})`)
                } else {
                    skipped++
                    console.log(`Skipped record: ${cloudRow.host} ${cloudRow.date} (local data is newer/better)`)
                }
            }
        } catch (error) {
            console.error(`Error merging record ${cloudRow.host} ${cloudRow.date}:`, error)
            skipped++
        }
    }
    
    const merged = added + updated
    console.log(`Merge completed: ${merged} total merged (${added} added, ${updated} updated, ${skipped} skipped)`)
    
    return { merged, added, updated, skipped }
}

/**
 * Resolve conflicts between local and cloud data
 */
async function resolveConflict(localRow: timer.core.Row, cloudRow: timer.core.Row): Promise<boolean> {
    // Simple conflict resolution strategy:
    // 1. If cloud has more data (focus/time/run), always update
    // 2. If local has more data, keep local
    // 3. If equal, skip (no update needed)
    
    const localTotal = (localRow.focus || 0) + (localRow.time || 0) + (localRow.run || 0)
    const cloudTotal = (cloudRow.focus || 0) + (cloudRow.time || 0) + (cloudRow.run || 0)
    
    if (cloudTotal > localTotal) {
        return true // Cloud has more data, update local
    }
    
    if (cloudTotal < localTotal) {
        return false // Local has more data, keep local
    }
    
    // Equal totals - no update needed
    return false
}

const TIME_FORMAT = t(msg => msg.calendar.timeFormat)

const _default = defineComponent<{ type: timer.backup.Type }>(props => {
    const [lastTime, setLastTime] = useState<number>()

    useRequest(async () => {
        const type = props.type
        return type && (await metaService.getLastBackUp(type))?.ts
    }, { deps: () => props.type, onSuccess: setLastTime })

    const { refresh: handleBackup } = useManualRequest(async () => {
        // Use the traditional processor for all backup types (manual sync only)
        return processor.syncData()
    }, {
        loadingText: "Doing backup....",
        onSuccess: ({ success, data, errorMsg }) => {
            if (success) {
                ElMessage.success('Successfully!')
                setLastTime(data ?? Date.now())
            } else {
                ElMessage.error(errorMsg ?? 'Unknown error')
            }
        },
    })

    return () => <>
        <ElDivider />
        <Flex gap={12}>
            <ElButton type="primary" icon={Operation} onClick={handleTest}>
                {t(msg => msg.button.test)}
            </ElButton>
            <Clear />
            <Download />
            <ElButton type="primary" icon={UploadFilled} onClick={handleBackup}>
                {t(msg => msg.option.backup.operation)}
            </ElButton>
            {props.type === 'aws' && (
                <ElButton type="success" icon={DownloadIcon} onClick={handleManualFetch}>
                    Download All Data
                </ElButton>
            )}
            <ElText v-show={!!lastTime.value} style={{ marginInlineStart: "8px" } satisfies StyleValue}>
                {t(
                    msg => msg.option.backup.lastTimeTip,
                    { lastTime: (lastTime.value && formatTime(lastTime.value, TIME_FORMAT)) ?? '' }
                )}
            </ElText>
        </Flex>
    </>
}, { props: ['type'] })

export default _default