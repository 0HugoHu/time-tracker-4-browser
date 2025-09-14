/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import statDatabase from "@db/stat-database"
import optionHolder from "@service/components/option-holder"

/**
 * Integration layer - Background sync disabled, manual sync only
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
        
        // Background sync disabled - manual sync only
        console.log('SyncIntegration: Background sync disabled, manual sync only')
        
        this.isInitialized = true
    }
    
    /**
     * Check if sync integration is enabled
     */
    isEnabled(): boolean {
        return this.isAwsSyncEnabled
    }
}

// Global singleton instance - background sync disabled
export const syncIntegration = new SyncIntegration()