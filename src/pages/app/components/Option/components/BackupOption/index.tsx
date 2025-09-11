/**
 * Copyright (c) 2022-present Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */
import {
    DEFAULT_VAULT as DEFAULT_OBSIDIAN_BUCKET,
    DEFAULT_ENDPOINT as DEFAULT_OBSIDIAN_ENDPOINT,
} from "@api/obsidian"
import { t } from "@app/locale"
import { ElInput, ElOption, ElSelect } from "element-plus"
import { computed, defineComponent } from "vue"
import { type OptionInstance } from "../../common"
import OptionItem from "../OptionItem"
import OptionTooltip from "../OptionTooltip"
import AutoInput from "./AutoInput"
import Footer from "./Footer"
import { useOptionState } from "./state"
import "./style.sass"

const ALL_TYPES: timer.backup.Type[] = [
    'none',
    'gist',
    'web_dav',
    'obsidian_local_rest_api',
    'aws',
]

const TYPE_NAMES: { [t in timer.backup.Type]: string } = {
    none: t(msg => msg.option.backup.meta.none.label),
    gist: 'GitHub Gist',
    obsidian_local_rest_api: 'Obsidian - Local REST API',
    web_dav: 'WebDAV',
    aws: 'AWS Real-time Sync'
}

const _default = defineComponent((_, ctx) => {
    const {
        backupType, clientName, reset,
        autoBackUp, autoBackUpInterval,
        auth, account, password,
        ext, setExtField,
    } = useOptionState()

    const isNotNone = computed(() => backupType.value && backupType.value !== 'none')

    ctx.expose({ reset } satisfies OptionInstance)

    return () => <>
        <OptionItem label={msg => msg.option.backup.type} defaultValue={TYPE_NAMES['none']} hideDivider>
            <ElSelect
                modelValue={backupType.value}
                size="small"
                onChange={(val: timer.backup.Type) => backupType.value = val}
            >
                {ALL_TYPES.map(type => <ElOption value={type} label={TYPE_NAMES[type]} />)}
            </ElSelect>
        </OptionItem >
        <OptionItem
            v-show={isNotNone.value}
            label={_ => "{input}"}
            defaultValue={t(msg => msg.option.no)}
        >
            <AutoInput
                autoBackup={autoBackUp.value}
                interval={autoBackUpInterval.value}
                onAutoBackupChange={val => autoBackUp.value = val}
                onIntervalChange={val => autoBackUpInterval.value = val}
            />
        </OptionItem>
        {backupType.value === 'gist' && <>
            <OptionItem
                key="gist-token"
                label={_ => 'Personal Access Token {info} {input}'}
                v-slots={{
                    info: () => <OptionTooltip>{t(msg => msg.option.backup.meta.gist.authInfo)}</OptionTooltip>
                }}
            >
                <ElInput
                    modelValue={auth.value}
                    size="small"
                    type="password"
                    showPassword
                    style={{ width: "400px" }}
                    onInput={val => auth.value = val?.trim?.() || ''}
                />
            </OptionItem>
        </>}
        {backupType.value === 'obsidian_local_rest_api' && <>
            <OptionItem
                key="obsidian-endpoint"
                label={msg => msg.option.backup.label.endpoint}
                v-slots={{
                    info: () => <OptionTooltip>{t(msg => msg.option.backup.meta.obsidian_local_rest_api.endpointInfo)}</OptionTooltip>
                }}
            >
                <ElInput
                    placeholder={DEFAULT_OBSIDIAN_ENDPOINT}
                    modelValue={ext.value?.endpoint}
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('endpoint', val)}
                />
            </OptionItem>
            <OptionItem label={_ => "Vault Name {input}"}>
                <ElInput
                    placeholder={DEFAULT_OBSIDIAN_BUCKET}
                    modelValue={ext.value?.bucket}
                    size="small"
                    style={{ width: "200px" }}
                    onInput={val => setExtField('bucket', val)}
                />
            </OptionItem>
            <OptionItem label={msg => msg.option.backup.label.path} required>
                <ElInput
                    modelValue={ext.value?.dirPath}
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('dirPath', val)}
                />
            </OptionItem>
            <OptionItem required label={_ => "Authorization {input}"}>
                <ElInput
                    modelValue={auth.value}
                    size="small"
                    type="password"
                    showPassword
                    style={{ width: "400px" }}
                    onInput={val => auth.value = val?.trim?.() || ''}
                />
            </OptionItem>
        </>}
        {backupType.value === 'web_dav' && <>
            <OptionItem
                key="web-dav-endpoint"
                label={msg => msg.option.backup.label.endpoint}
                v-slots={{ info: () => '' }}
                required
            >
                <ElInput
                    modelValue={ext.value?.endpoint}
                    placeholder="https://for.example.com:443"
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('endpoint', val)}
                />
            </OptionItem>
            <OptionItem label={msg => msg.option.backup.label.path} required>
                <ElInput
                    modelValue={ext.value?.dirPath}
                    placeholder="/for/example"
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('dirPath', val)}
                />
            </OptionItem>
            <OptionItem label={msg => msg.option.backup.label.account} required>
                <ElInput
                    modelValue={account.value}
                    size="small"
                    style={{ width: "200px" }}
                    onInput={val => account.value = val?.trim?.()}
                />
            </OptionItem>
            <OptionItem label={msg => msg.option.backup.label.password} required>
                <ElInput
                    modelValue={password.value}
                    size="small"
                    showPassword
                    style={{ width: "300px" }}
                    onInput={val => password.value = val?.trim?.()}
                />
            </OptionItem>
        </>}
        {backupType.value === 'aws' && <>
            <OptionItem
                key="aws-api-key"
                label={_ => 'API Key {info} {input}'}
                v-slots={{
                    info: () => <OptionTooltip>{'AWS API Gateway key for authentication'}</OptionTooltip>
                }}
                required
            >
                <ElInput
                    modelValue={auth.value}
                    size="small"
                    type="password"
                    showPassword
                    style={{ width: "400px" }}
                    onInput={val => auth.value = val?.trim?.() || ''}
                    placeholder="Enter your AWS API key"
                />
            </OptionItem>
            <OptionItem
                key="aws-api-endpoint"
                label={_ => 'API Endpoint {info} {input}'}
                v-slots={{
                    info: () => <OptionTooltip>{'AWS API Gateway endpoint URL from CDK deployment'}</OptionTooltip>
                }}
                required
            >
                <ElInput
                    modelValue={ext.value?.apiEndpoint}
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('apiEndpoint', val)}
                    placeholder="https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod"
                />
            </OptionItem>
            <OptionItem
                key="aws-websocket-endpoint"
                label={_ => 'WebSocket Endpoint {info} {input}'}
                v-slots={{
                    info: () => <OptionTooltip>{'AWS WebSocket API endpoint for real-time updates'}</OptionTooltip>
                }}
            >
                <ElInput
                    modelValue={ext.value?.websocketEndpoint}
                    size="small"
                    style={{ width: "400px" }}
                    onInput={val => setExtField('websocketEndpoint', val)}
                    placeholder="wss://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod"
                />
            </OptionItem>
            <OptionItem
                key="aws-region"
                label={_ => 'AWS Region {input}'}
            >
                <ElInput
                    modelValue={ext.value?.region || 'us-east-1'}
                    size="small"
                    style={{ width: "200px" }}
                    onInput={val => setExtField('region', val)}
                    placeholder="us-east-1"
                />
            </OptionItem>
        </>}
        <OptionItem v-show={isNotNone.value} label={msg => msg.option.backup.client}>
            <ElInput
                modelValue={clientName.value}
                size="small"
                style={{ width: "120px" }}
                onInput={val => clientName.value = val?.trim?.() || ''}
            />
        </OptionItem>
        {isNotNone.value && <Footer type={backupType.value} />}
    </>
})

export default _default