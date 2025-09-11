/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import processor from "@service/backup/processor"
import statDatabase from "@db/stat-database"
import optionHolder from "@service/components/option-holder"
import metaService from "@service/meta-service"
import { formatTimeYMD } from "@util/time"
import { hybridSyncManager } from "./hybrid-sync-manager"
import AwsCoordinator from "@service/backup/aws/coordinator"

type PendingSync = {
    rows: timer.core.Row[]
    timestamp: number
    retryCount: number
    batchId: string
}

type SyncStats = {
    totalSynced: number
    totalFailed: number
    lastSyncTime: number
    pendingCount: number
    isOnline: boolean
}

/**
 * Background service for automatic real-time sync
 */
export class BackgroundSyncService {
    private isEnabled = false
    private syncQueue: PendingSync[] = []
    private isProcessing = false
    private readonly maxRetries = 3
    private readonly batchSize = 50 // Max rows per sync batch
    private readonly syncIntervalMs = 15000 // 15 seconds between batch syncs
    private readonly maxQueueSize = 1000 // Max rows in queue before dropping oldest
    private syncInterval: NodeJS.Timeout | null = null
    private stats: SyncStats = {
        totalSynced: 0,
        totalFailed: 0,
        lastSyncTime: 0,
        pendingCount: 0,
        isOnline: navigator.onLine
    }
    
    constructor() {
        this.init()
        this.setupEventListeners()
    }
    
    private async init(): Promise<void> {
        // Check if AWS sync is enabled
        const option = await optionHolder.get()
        this.isEnabled = option.backupType === 'aws'
        
        if (this.isEnabled) {
            this.startBackgroundSync()
        }
        
        // Listen for hybrid sync manager events
        hybridSyncManager.on('data-updated', (data: any) => {
            this.handleRemoteUpdate(data)
        })
    }
    
    private setupEventListeners(): void {
        // In service workers, we need to use navigator.onLine and periodically check
        // or rely on network request failures to detect offline status
        
        // For service workers, we can't listen to window events
        // Instead, we'll check online status periodically and on network failures
        if (typeof window !== 'undefined') {
            // If we're in a window context (not service worker)
            window.addEventListener('online', () => {
                console.log('BackgroundSyncService: Back online')
                this.stats.isOnline = true
                if (this.isEnabled) {
                    this.processQueue() // Process any pending items
                }
            })
            
            window.addEventListener('offline', () => {
                console.log('BackgroundSyncService: Gone offline')
                this.stats.isOnline = false
            })
            
            // Handle page unload to save pending syncs
            window.addEventListener('beforeunload', () => {
                this.savePendingSyncs()
            })
        } else {
            // In service worker context, we need alternative approaches
            // Periodically check navigator.onLine
            setInterval(() => {
                const wasOnline = this.stats.isOnline
                this.stats.isOnline = navigator.onLine
                
                if (!wasOnline && this.stats.isOnline && this.isEnabled) {
                    console.log('BackgroundSyncService: Detected back online')
                    this.processQueue()
                }
            }, 5000) // Check every 5 seconds
        }
    }
    
    /**
     * Start the background sync service
     */
    async startBackgroundSync(): Promise<void> {
        if (this.syncInterval) {
            return // Already running
        }
        
        console.log('BackgroundSyncService: Starting background sync')
        
        // Load any previously pending syncs
        await this.loadPendingSyncs()
        
        // Start periodic processing
        this.syncInterval = setInterval(async () => {
            if (this.isEnabled && this.stats.isOnline && !this.isProcessing) {
                await this.processQueue()
            }
        }, this.syncIntervalMs)
        
        // Process queue immediately if there are pending items
        if (this.syncQueue.length > 0) {
            this.processQueue()
        }
    }
    
    /**
     * Stop the background sync service
     */
    stopBackgroundSync(): void {
        console.log('BackgroundSyncService: Stopping background sync')
        
        if (this.syncInterval) {
            clearInterval(this.syncInterval)
            this.syncInterval = null
        }
        
        this.savePendingSyncs()
    }
    
    /**
     * Enable/disable the background sync service
     */
    async setEnabled(enabled: boolean): Promise<void> {
        this.isEnabled = enabled
        
        if (enabled) {
            await this.startBackgroundSync()
        } else {
            this.stopBackgroundSync()
        }
    }
    
    /**
     * Queue rows for background sync
     */
    queueForSync(rows: timer.core.Row[]): void {
        if (!this.isEnabled || !rows || rows.length === 0) {
            return
        }
        
        const pendingSync: PendingSync = {
            rows,
            timestamp: Date.now(),
            retryCount: 0,
            batchId: `bg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
        }
        
        this.syncQueue.push(pendingSync)
        this.stats.pendingCount = this.syncQueue.length
        
        // Remove old items if queue is too large
        while (this.syncQueue.length > this.maxQueueSize) {
            const removed = this.syncQueue.shift()
            console.warn('BackgroundSyncService: Dropping old sync batch:', removed?.batchId)
        }
        
        console.log(`BackgroundSyncService: Queued ${rows.length} rows for sync (${this.syncQueue.length} batches pending)`)
        
        // Process immediately if online and not already processing
        if (this.stats.isOnline && !this.isProcessing) {
            setTimeout(() => this.processQueue(), 1000) // Small delay to batch multiple calls
        }
    }
    
    /**
     * Process the sync queue
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.syncQueue.length === 0 || !this.stats.isOnline) {
            return
        }
        
        this.isProcessing = true
        
        try {
            // Process batches up to the batch size
            let processedCount = 0
            const maxBatches = Math.ceil(this.batchSize / 10) // Assume average 10 rows per batch
            
            while (this.syncQueue.length > 0 && processedCount < maxBatches) {
                const batch = this.syncQueue[0]
                
                try {
                    await this.syncBatch(batch)
                    
                    // Successfully synced - remove from queue
                    this.syncQueue.shift()
                    this.stats.totalSynced += batch.rows.length
                    this.stats.lastSyncTime = Date.now()
                    processedCount++
                    
                    console.log(`BackgroundSyncService: Synced batch ${batch.batchId} (${batch.rows.length} rows)`)
                } catch (error) {
                    console.error(`BackgroundSyncService: Failed to sync batch ${batch.batchId}:`, error)
                    
                    batch.retryCount++
                    
                    if (batch.retryCount >= this.maxRetries) {
                        // Too many retries - remove from queue
                        this.syncQueue.shift()
                        this.stats.totalFailed += batch.rows.length
                        console.error(`BackgroundSyncService: Dropping batch ${batch.batchId} after ${this.maxRetries} retries`)
                    } else {
                        // Keep for retry but move to end of queue
                        this.syncQueue.shift()
                        this.syncQueue.push(batch)
                        break // Stop processing for now
                    }
                }
            }
            
            this.stats.pendingCount = this.syncQueue.length
        } finally {
            this.isProcessing = false
        }
    }
    
    /**
     * Sync a single batch
     */
    private async syncBatch(batch: PendingSync): Promise<void> {
        const { option, coordinator, errorMsg } = await processor.checkAuth()
        
        if (errorMsg || !coordinator || option.backupType !== 'aws') {
            throw new Error(errorMsg || 'AWS sync not configured')
        }
        
        const clientId = await metaService.getCid()
        if (!clientId) {
            throw new Error('No client ID available')
        }
        
        // Create context for the coordinator
        const context: timer.backup.CoordinatorContext<unknown> = {
            cid: clientId,
            auth: { token: option.backupAuths?.aws },
            ext: option.backupExts?.aws,
            cache: {},
            handleCacheChanged: async () => {
                // Cache changes handled by processor
            }
        }
        
        // Use incremental sync if available
        if (coordinator instanceof AwsCoordinator && (coordinator as any).syncIncremental) {
            await (coordinator as any).syncIncremental(context, batch.rows)
        } else {
            // Fallback to regular upload
            await coordinator.upload(context, batch.rows)
        }
    }
    
    /**
     * Handle remote updates from other clients
     */
    private handleRemoteUpdate(data: any): void {
        if (!data.rows || !Array.isArray(data.rows)) {
            return
        }
        
        console.log(`BackgroundSyncService: Received ${data.rows.length} remote updates`)
        
        // Merge remote data into local database
        this.mergeRemoteData(data.rows)
    }
    
    /**
     * Merge remote data into local database
     */
    private async mergeRemoteData(remoteRows: timer.backup.Row[]): Promise<void> {
        try {
            const localClientId = await metaService.getCid()
            
            for (const remoteRow of remoteRows) {
                // Skip our own data
                if (remoteRow.cid === localClientId) {
                    continue
                }
                
                const { host, date, focus, time } = remoteRow
                
                // Get existing local data
                const existing = await statDatabase.get(host, date)
                
                // Simple conflict resolution: take maximum values
                const mergedFocus = Math.max(existing.focus || 0, focus || 0)
                const mergedTime = Math.max(existing.time || 0, time || 0)
                
                // Update local data if there's a change
                if (mergedFocus !== (existing.focus || 0) || mergedTime !== (existing.time || 0)) {
                    await statDatabase.accumulate(host, date, {
                        focus: mergedFocus - (existing.focus || 0),
                        time: mergedTime - (existing.time || 0)
                    })
                }
            }
            
            console.log(`BackgroundSyncService: Merged ${remoteRows.length} remote rows`)
        } catch (error) {
            console.error('BackgroundSyncService: Error merging remote data:', error)
        }
    }
    
    /**
     * Save pending syncs to storage for recovery
     */
    private async savePendingSyncs(): Promise<void> {
        if (this.syncQueue.length === 0) {
            return
        }
        
        try {
            const pendingData = {
                queue: this.syncQueue,
                timestamp: Date.now()
            }
            
            await chrome.storage.local.set({
                'background_sync_pending': pendingData
            })
            
            console.log(`BackgroundSyncService: Saved ${this.syncQueue.length} pending syncs`)
        } catch (error) {
            console.error('BackgroundSyncService: Failed to save pending syncs:', error)
        }
    }
    
    /**
     * Load pending syncs from storage
     */
    private async loadPendingSyncs(): Promise<void> {
        try {
            const result = await chrome.storage.local.get('background_sync_pending')
            const pendingData = result.background_sync_pending
            
            if (pendingData && pendingData.queue && Array.isArray(pendingData.queue)) {
                // Only restore recent items (within last hour)
                const oneHourAgo = Date.now() - (60 * 60 * 1000)
                const recentItems = pendingData.queue.filter((item: PendingSync) => 
                    item.timestamp > oneHourAgo
                )
                
                this.syncQueue = recentItems
                this.stats.pendingCount = this.syncQueue.length
                
                console.log(`BackgroundSyncService: Loaded ${this.syncQueue.length} pending syncs from storage`)
                
                // Clear the stored data
                await chrome.storage.local.remove('background_sync_pending')
            }
        } catch (error) {
            console.error('BackgroundSyncService: Failed to load pending syncs:', error)
        }
    }
    
    /**
     * Force immediate sync of all pending items
     */
    async forceSync(): Promise<void> {
        if (!this.isEnabled || !this.stats.isOnline) {
            throw new Error('Sync not available')
        }
        
        console.log('BackgroundSyncService: Forcing immediate sync')
        await this.processQueue()
    }
    
    /**
     * Get current sync statistics
     */
    getStats(): SyncStats {
        return { ...this.stats }
    }
    
    /**
     * Clear all pending syncs
     */
    clearQueue(): void {
        this.syncQueue = []
        this.stats.pendingCount = 0
        console.log('BackgroundSyncService: Cleared sync queue')
    }
    
    /**
     * Get pending sync count
     */
    getPendingCount(): number {
        return this.syncQueue.length
    }
    
    /**
     * Check if service is actively syncing
     */
    isSyncing(): boolean {
        return this.isProcessing
    }
}

// Global singleton instance
export const backgroundSyncService = new BackgroundSyncService()