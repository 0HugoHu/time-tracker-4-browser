/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { downloadData, listClients, testConnection, updateData, uploadData, type AwsConfig, type ConflictInfo } from "@api/aws"
import { formatTimeYMD } from "@util/time"

/**
 * Cache for AWS coordinator
 */
type AwsCache = {
    lastSyncTimestamp?: number
    sessionId?: string
    batchCounter?: number
}

/**
 * Generate session ID for conflict resolution
 */
function generateSessionId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate batch ID for tracking related operations
 */
function generateBatchId(counter: number): string {
    return `batch_${Date.now()}_${counter}`
}

/**
 * Convert timer.core.Row to timer.core.EnhancedRow
 */
function enhanceRow(row: timer.core.Row, sessionId: string, batchId: string): timer.core.EnhancedRow {
    return {
        ...row,
        sessionId,
        lastModified: Date.now(),
        version: 1,
        batchId
    }
}

/**
 * AWS Coordinator for real-time sync
 */
export default class AwsCoordinator implements timer.backup.Coordinator<AwsCache> {
    
    private getConfig(context: timer.backup.CoordinatorContext<AwsCache>): AwsConfig {
        const { auth, ext } = context
        
        if (!auth?.token) {
            throw new Error('AWS API key is required')
        }
        
        if (!ext?.apiEndpoint) {
            throw new Error('AWS API endpoint is required')
        }
        
        return {
            apiKey: auth.token,
            apiEndpoint: ext.apiEndpoint,
            websocketEndpoint: ext.websocketEndpoint || '',
            region: ext.region || 'us-east-1'
        }
    }
    
    private ensureSessionId(context: timer.backup.CoordinatorContext<AwsCache>): string {
        if (!context.cache.sessionId) {
            context.cache.sessionId = generateSessionId()
            context.handleCacheChanged()
        }
        return context.cache.sessionId
    }
    
    private getNextBatchId(context: timer.backup.CoordinatorContext<AwsCache>): string {
        const counter = (context.cache.batchCounter || 0) + 1
        context.cache.batchCounter = counter
        context.handleCacheChanged()
        return generateBatchId(counter)
    }

    async updateClients(
        context: timer.backup.CoordinatorContext<AwsCache>,
        clients: timer.backup.Client[]
    ): Promise<void> {
        // For AWS, client management is handled automatically
        // The backend tracks clients through their sync operations
        // This method exists to maintain interface compatibility
        console.log('AWS: Client list updated automatically through sync operations')
    }

    async listAllClients(context: timer.backup.CoordinatorContext<AwsCache>): Promise<timer.backup.Client[]> {
        const config = this.getConfig(context)
        
        try {
            const response = await listClients(config, context.cid)
            return response.clients || []
        } catch (error) {
            console.error('AWS: Failed to list clients:', error)
            return []
        }
    }

    async download(
        context: timer.backup.CoordinatorContext<AwsCache>,
        dateStart: Date,
        dateEnd: Date,
        targetCid?: string
    ): Promise<timer.core.Row[]> {
        const config = this.getConfig(context)
        
        try {
            const response = await downloadData(config, context.cid, {
                startDate: formatTimeYMD(dateStart),
                endDate: formatTimeYMD(dateEnd),
                clientId: targetCid
            })
            
            return response.data || []
        } catch (error) {
            console.error('AWS: Failed to download data:', error)
            throw new Error(`Failed to download data: ${error instanceof Error ? error.message : error}`)
        }
    }

    async upload(
        context: timer.backup.CoordinatorContext<AwsCache>,
        rows: timer.core.Row[]
    ): Promise<void> {
        if (!rows || rows.length === 0) {
            return
        }
        
        const config = this.getConfig(context)
        const sessionId = this.ensureSessionId(context)
        const batchId = this.getNextBatchId(context)
        
        // Convert rows to enhanced format
        const enhancedRows = rows.map(row => enhanceRow(row, sessionId, batchId))
        
        try {
            const response = await uploadData(config, context.cid, enhancedRows, batchId)
            
            // Log conflicts for monitoring
            const conflicts = response.results
                .filter(r => r.conflicts && r.conflicts.length > 0)
                .flatMap(r => r.conflicts!)
            
            if (conflicts.length > 0) {
                console.warn(`AWS: Resolved ${conflicts.length} conflicts during upload:`, conflicts)
                await this.handleConflicts(context, conflicts)
            }
            
            // Update sync timestamp
            context.cache.lastSyncTimestamp = Date.now()
            await context.handleCacheChanged()
            
            console.log(`AWS: Successfully uploaded ${response.successful}/${response.processed} rows`)
            
            if (response.failed > 0) {
                const failures = response.results.filter(r => r.error)
                console.error('AWS: Upload failures:', failures)
                throw new Error(`${response.failed} rows failed to upload`)
            }
        } catch (error) {
            console.error('AWS: Failed to upload data:', error)
            throw new Error(`Failed to upload data: ${error instanceof Error ? error.message : error}`)
        }
    }

    async testAuth(auth: timer.backup.Auth, ext: timer.backup.TypeExt): Promise<string | undefined> {
        if (!auth?.token) {
            return 'AWS API key is required'
        }
        
        if (!ext?.apiEndpoint) {
            return 'AWS API endpoint is required'
        }
        
        const config: AwsConfig = {
            apiKey: auth.token,
            apiEndpoint: ext.apiEndpoint,
            websocketEndpoint: ext.websocketEndpoint || '',
            region: ext.region || 'us-east-1'
        }
        
        try {
            return await testConnection(config, 'test-client')
        } catch (error) {
            return error instanceof Error ? error.message : 'Connection test failed'
        }
    }

    async clear(
        context: timer.backup.CoordinatorContext<AwsCache>,
        client: timer.backup.Client
    ): Promise<void> {
        // For AWS, we don't directly delete data from the backend
        // Instead, we mark the client as inactive or handle it through lifecycle policies
        console.warn(`AWS: Clear operation for client ${client.id} not implemented - data will be archived automatically`)
    }
    
    /**
     * Handle conflicts that occurred during upload
     * This could trigger UI notifications or automatic resolution strategies
     */
    private async handleConflicts(
        context: timer.backup.CoordinatorContext<AwsCache>,
        conflicts: ConflictInfo[]
    ): Promise<void> {
        // Group conflicts by type for analysis
        const sessionConflicts = conflicts.filter(c => c.type === 'session_conflict')
        const timestampConflicts = conflicts.filter(c => c.type === 'timestamp_conflict')
        
        if (sessionConflicts.length > 0) {
            console.log(`AWS: ${sessionConflicts.length} session conflicts resolved (different browser sessions)`)
        }
        
        if (timestampConflicts.length > 0) {
            console.log(`AWS: ${timestampConflicts.length} timestamp conflicts resolved (newer data took precedence)`)
        }
        
        // In a more sophisticated implementation, you might:
        // 1. Show user notifications about conflicts
        // 2. Store conflict logs for analysis
        // 3. Implement custom resolution strategies
        // 4. Trigger UI updates to show resolved data
    }
    
    /**
     * Perform incremental sync of specific rows (for real-time updates)
     */
    async syncIncremental(
        context: timer.backup.CoordinatorContext<AwsCache>,
        rows: timer.core.Row[]
    ): Promise<void> {
        if (!rows || rows.length === 0) {
            return
        }
        
        const config = this.getConfig(context)
        const sessionId = this.ensureSessionId(context)
        const batchId = this.getNextBatchId(context)
        
        // Convert rows to enhanced format
        const enhancedRows = rows.map(row => enhanceRow(row, sessionId, batchId))
        
        try {
            const response = await updateData(config, context.cid, enhancedRows)
            
            console.log(`AWS: Incremental sync completed: ${response.successful}/${response.processed} rows`)
            
            if (response.failed > 0) {
                console.warn(`AWS: ${response.failed} rows failed in incremental sync`)
            }
        } catch (error) {
            console.error('AWS: Incremental sync failed:', error)
            // Don't throw here - incremental sync failures shouldn't break the app
        }
    }
}