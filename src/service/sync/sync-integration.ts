/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { backgroundSyncService } from "./background-sync-service"
import { hybridSyncManager } from "./hybrid-sync-manager"
import statDatabase from "@db/stat-database"
import optionHolder from "@service/components/option-holder"

/**
 * Integration layer that automatically syncs database changes
 */
class SyncIntegration {
    private isInitialized = false
    private isAwsSyncEnabled = false
    
    async init(): Promise<void> {
        if (this.isInitialized) {
            return
        }
        
        // Check if AWS sync is enabled
        const option = await optionHolder.get()
        this.isAwsSyncEnabled = option.backupType === 'aws'
        
        if (this.isAwsSyncEnabled) {
            console.log('SyncIntegration: Initializing AWS real-time sync')
            
            // Start sync services
            await hybridSyncManager.setEnabled(true)
            await backgroundSyncService.setEnabled(true)
            
            // Hook into database operations
            this.wrapDatabaseMethods()
            
            console.log('SyncIntegration: AWS real-time sync initialized successfully')
        }
        
        this.isInitialized = true
    }
    
    /**
     * Wrap database methods to automatically queue changes for sync
     */
    private wrapDatabaseMethods(): void {
        // Store original methods
        const originalAccumulate = statDatabase.accumulate.bind(statDatabase)
        const originalAccumulateBatch = statDatabase.accumulateBatch.bind(statDatabase)
        const originalForceUpdate = statDatabase.forceUpdate.bind(statDatabase)
        
        // Wrap accumulate method
        statDatabase.accumulate = async (host: string, date: Date | string, item: timer.core.Result): Promise<timer.core.Result> => {
            const result = await originalAccumulate(host, date, item)
            
            // Queue for sync if AWS is enabled
            if (this.isAwsSyncEnabled) {
                this.queueRowForSync(host, date, result)
            }
            
            return result
        }
        
        // Wrap accumulateBatch method
        statDatabase.accumulateBatch = async (data: Record<string, timer.core.Result>, date: Date | string): Promise<Record<string, timer.core.Result>> => {
            const results = await originalAccumulateBatch(data, date)
            
            // Queue all rows for sync if AWS is enabled
            if (this.isAwsSyncEnabled) {
                Object.entries(results).forEach(([host, result]) => {
                    this.queueRowForSync(host, date, result)
                })
            }
            
            return results
        }
        
        // Wrap forceUpdate method
        statDatabase.forceUpdate = async (row: timer.core.Row): Promise<void> => {
            await originalForceUpdate(row)
            
            // Queue for sync if AWS is enabled
            if (this.isAwsSyncEnabled) {
                this.queueRowForSync(row.host, row.date, {
                    focus: row.focus || 0,
                    time: row.time || 0,
                    run: row.run
                })
            }
        }
        
        console.log('SyncIntegration: Database methods wrapped for automatic sync')
    }
    
    /**
     * Queue a single row for background sync
     */
    private queueRowForSync(host: string, date: Date | string, result: timer.core.Result): void {
        const dateStr = typeof date === 'string' ? date : this.formatDate(date)
        
        const row: timer.core.Row = {
            host,
            date: dateStr,
            focus: result.focus || 0,
            time: result.time || 0,
            run: result.run
        }
        
        backgroundSyncService.queueForSync([row])
    }
    
    /**
     * Format date as YYYYMMDD
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}${month}${day}`
    }
    
    /**
     * Enable/disable sync integration
     */
    async setEnabled(enabled: boolean): Promise<void> {
        this.isAwsSyncEnabled = enabled
        
        if (enabled) {
            await this.init()
        } else {
            await hybridSyncManager.setEnabled(false)
            await backgroundSyncService.setEnabled(false)
        }
    }
    
    /**
     * Check if sync integration is enabled
     */
    isEnabled(): boolean {
        return this.isAwsSyncEnabled
    }
    
    /**
     * Get sync status from both services
     */
    getStatus(): {
        hybrid: ReturnType<typeof hybridSyncManager.getStatus>
        background: ReturnType<typeof backgroundSyncService.getStats>
    } {
        return {
            hybrid: hybridSyncManager.getStatus(),
            background: backgroundSyncService.getStats()
        }
    }
    
    /**
     * Force immediate sync
     */
    async forceSync(): Promise<void> {
        if (!this.isAwsSyncEnabled) {
            throw new Error('AWS sync not enabled')
        }
        
        await Promise.all([
            hybridSyncManager.forcSync(),
            backgroundSyncService.forceSync()
        ])
    }
    
    /**
     * Listen for remote data updates
     */
    onRemoteUpdate(callback: (data: any) => void): void {
        hybridSyncManager.on('data-updated', callback)
    }
    
    /**
     * Listen for sync status changes
     */
    onSyncStatusChange(callback: (status: any) => void): void {
        hybridSyncManager.on('sync-status', callback)
    }
}

// Global singleton instance
export const syncIntegration = new SyncIntegration()

// Initialize when extension is ready
let isInitializing = false
const initWhenReady = async () => {
    if (isInitializing) return
    
    try {
        isInitializing = true
        
        // Wait for extension context to be stable
        if (!chrome?.runtime?.id) {
            isInitializing = false
            setTimeout(initWhenReady, 1000)
            return
        }
        
        await syncIntegration.init()
        console.log('SyncIntegration initialized successfully')
        isInitializing = false
    } catch (error) {
        console.error('Failed to initialize SyncIntegration:', error)
        isInitializing = false
        // Retry after delay if initialization fails
        setTimeout(initWhenReady, 3000)
    }
}

// Start initialization
initWhenReady()