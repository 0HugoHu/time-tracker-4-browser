/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import processor from "@service/backup/processor"
import metaService from "@service/meta-service"
import optionHolder from "@service/components/option-holder"

type SyncEvent = {
    type: 'data-updated' | 'client-connected' | 'sync-status'
    data: any
    timestamp: string
}

type WebSocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Hybrid sync manager that combines WebSocket push notifications with polling fallback
 */
export class HybridSyncManager {
    private websocket: WebSocket | null = null
    private pollInterval: NodeJS.Timeout | null = null
    private reconnectTimeout: NodeJS.Timeout | null = null
    private backoffMultiplier = 1
    private readonly maxBackoffMs = 60000 // 1 minute max backoff
    private readonly baseBackoffMs = 1000 // 1 second base backoff
    private readonly pollIntervalMs = 30000 // 30 seconds polling fallback
    private connectionState: WebSocketConnectionState = 'disconnected'
    private listeners: Map<string, Function[]> = new Map()
    private isEnabled = false
    private clientId: string | null = null
    
    constructor() {
        this.init()
    }
    
    private async init(): Promise<void> {
        this.clientId = (await metaService.getCid()) || null
        
        // Check if AWS sync is enabled
        const option = await optionHolder.get()
        this.isEnabled = option.backupType === 'aws'
        
        if (this.isEnabled && this.clientId) {
            this.startSync()
        }
    }
    
    /**
     * Start the hybrid sync process
     */
    async startSync(): Promise<void> {
        if (!this.isEnabled || !this.clientId) {
            console.log('HybridSyncManager: Sync not enabled or no client ID')
            return
        }
        
        console.log('HybridSyncManager: Starting sync...')
        
        // Try WebSocket connection first
        try {
            await this.connectWebSocket()
        } catch (error) {
            console.warn('HybridSyncManager: WebSocket connection failed, falling back to polling:', error)
            this.startPolling()
        }
    }
    
    /**
     * Stop all sync activities
     */
    stopSync(): void {
        console.log('HybridSyncManager: Stopping sync...')
        
        this.closeWebSocket()
        this.stopPolling()
        this.clearReconnectTimeout()
        this.connectionState = 'disconnected'
        this.emit('sync-status', { connected: false, method: 'none' })
    }
    
    /**
     * Enable/disable the sync manager
     */
    async setEnabled(enabled: boolean): Promise<void> {
        this.isEnabled = enabled
        
        if (enabled && this.clientId) {
            await this.startSync()
        } else {
            this.stopSync()
        }
    }
    
    /**
     * Connect to WebSocket for real-time updates
     */
    private async connectWebSocket(): Promise<void> {
        if (!this.clientId) {
            throw new Error('No client ID available')
        }
        
        const option = await optionHolder.get()
        const websocketEndpoint = option.backupExts?.aws?.websocketEndpoint
        
        if (!websocketEndpoint) {
            throw new Error('No WebSocket endpoint configured')
        }
        
        this.connectionState = 'connecting'
        this.emit('sync-status', { connected: false, method: 'websocket', status: 'connecting' })
        
        // Build WebSocket URL with client ID
        // Handle different URL formats
        const wsUrl = websocketEndpoint.startsWith('wss://') 
            ? websocketEndpoint 
            : `wss://${websocketEndpoint}`
        
        const url = new URL(wsUrl)
        url.searchParams.set('clientId', this.clientId)
        
        this.websocket = new WebSocket(url.toString())
        
        this.websocket.onopen = () => {
            console.log('HybridSyncManager: WebSocket connected')
            this.connectionState = 'connected'
            this.backoffMultiplier = 1 // Reset backoff on successful connection
            this.stopPolling() // Stop polling when WebSocket works
            this.emit('sync-status', { connected: true, method: 'websocket' })
        }
        
        this.websocket.onmessage = (event) => {
            try {
                const syncEvent: SyncEvent = JSON.parse(event.data)
                this.handleSyncEvent(syncEvent)
            } catch (error) {
                console.error('HybridSyncManager: Error parsing WebSocket message:', error)
            }
        }
        
        this.websocket.onclose = (event) => {
            console.log('HybridSyncManager: WebSocket closed:', event.code, event.reason)
            this.connectionState = 'disconnected'
            this.websocket = null
            
            // Fallback to polling and schedule reconnection
            this.startPolling()
            this.scheduleReconnect()
            this.emit('sync-status', { connected: false, method: 'polling' })
        }
        
        this.websocket.onerror = (error) => {
            console.error('HybridSyncManager: WebSocket error:', error)
            this.connectionState = 'error'
            this.emit('sync-status', { connected: false, method: 'error', error })
        }
        
        // Set a connection timeout
        setTimeout(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
                console.warn('HybridSyncManager: WebSocket connection timeout')
                this.websocket.close()
            }
        }, 10000) // 10 second timeout
    }
    
    /**
     * Close WebSocket connection
     */
    private closeWebSocket(): void {
        if (this.websocket) {
            this.websocket.close()
            this.websocket = null
        }
    }
    
    /**
     * Start polling as fallback
     */
    private startPolling(): void {
        if (this.pollInterval) {
            return // Already polling
        }
        
        console.log('HybridSyncManager: Starting polling fallback')
        
        this.pollInterval = setInterval(async () => {
            try {
                await this.performPollSync()
                
                // Try to reconnect to WebSocket if we're polling
                if (!this.websocket || this.websocket.readyState === WebSocket.CLOSED) {
                    if (Math.random() < 0.1) { // 10% chance to attempt reconnection on each poll
                        this.connectWebSocket().catch(() => {
                            // Ignore reconnection failures during polling
                        })
                    }
                }
            } catch (error) {
                console.error('HybridSyncManager: Polling error:', error)
            }
        }, this.pollIntervalMs)
    }
    
    /**
     * Stop polling
     */
    private stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
            this.pollInterval = null
            console.log('HybridSyncManager: Stopped polling')
        }
    }
    
    /**
     * Schedule WebSocket reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (!this.isEnabled) {
            return
        }
        
        this.clearReconnectTimeout()
        
        const delay = Math.min(this.baseBackoffMs * this.backoffMultiplier, this.maxBackoffMs)
        this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 60)
        
        console.log(`HybridSyncManager: Scheduling reconnection in ${delay}ms`)
        
        this.reconnectTimeout = setTimeout(async () => {
            if (this.isEnabled && this.clientId) {
                try {
                    await this.connectWebSocket()
                } catch (error) {
                    console.warn('HybridSyncManager: Reconnection failed:', error)
                    this.scheduleReconnect()
                }
            }
        }, delay)
    }
    
    /**
     * Clear reconnection timeout
     */
    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }
    }
    
    /**
     * Perform sync check via polling
     */
    private async performPollSync(): Promise<void> {
        try {
            // Check for remote updates
            const result = await processor.query({
                start: new Date(Date.now() - this.pollIntervalMs * 2), // Look back 1 minute
                end: new Date(),
                excludeLocal: true // Only get remote changes
            })
            
            if (result.length > 0) {
                console.log(`HybridSyncManager: Poll found ${result.length} remote updates`)
                this.emit('data-updated', { 
                    rows: result, 
                    source: 'poll',
                    timestamp: new Date().toISOString()
                })
            }
        } catch (error) {
            console.error('HybridSyncManager: Poll sync error:', error)
        }
    }
    
    /**
     * Handle incoming sync events
     */
    private handleSyncEvent(event: SyncEvent): void {
        console.log('HybridSyncManager: Received sync event:', event.type)
        
        switch (event.type) {
            case 'data-updated':
                this.emit('data-updated', event.data)
                break
            case 'client-connected':
                this.emit('client-connected', event.data)
                break
            case 'sync-status':
                this.emit('sync-status', event.data)
                break
            default:
                console.warn('HybridSyncManager: Unknown event type:', event.type)
        }
    }
    
    /**
     * Send a message via WebSocket
     */
    sendMessage(message: any): boolean {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message))
            return true
        }
        return false
    }
    
    /**
     * Subscribe to ping to keep connection alive
     */
    private startHeartbeat(): void {
        setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    action: 'ping',
                    timestamp: Date.now()
                }))
            }
        }, 30000) // Ping every 30 seconds
    }
    
    /**
     * Add event listener
     */
    on(event: string, callback: Function): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
        }
        this.listeners.get(event)!.push(callback)
    }
    
    /**
     * Remove event listener
     */
    off(event: string, callback: Function): void {
        const callbacks = this.listeners.get(event)
        if (callbacks) {
            const index = callbacks.indexOf(callback)
            if (index !== -1) {
                callbacks.splice(index, 1)
            }
        }
    }
    
    /**
     * Emit event to listeners
     */
    private emit(event: string, data: any): void {
        const callbacks = this.listeners.get(event)
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data)
                } catch (error) {
                    console.error(`HybridSyncManager: Error in event callback for ${event}:`, error)
                }
            })
        }
    }
    
    /**
     * Get current connection status
     */
    getStatus(): { connected: boolean; method: string; state: WebSocketConnectionState } {
        return {
            connected: this.connectionState === 'connected',
            method: this.websocket ? 'websocket' : (this.pollInterval ? 'polling' : 'none'),
            state: this.connectionState
        }
    }
    
    /**
     * Force a sync check
     */
    async forcSync(): Promise<void> {
        await this.performPollSync()
    }
    
    /**
     * Check if real-time sync is available
     */
    isRealTimeAvailable(): boolean {
        return this.websocket !== null && this.websocket.readyState === WebSocket.OPEN
    }
}

// Global singleton instance
export const hybridSyncManager = new HybridSyncManager()