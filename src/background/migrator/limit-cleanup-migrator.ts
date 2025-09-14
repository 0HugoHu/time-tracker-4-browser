/**
 * Copyright (c) 2024 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import optionHolder from "@service/components/option-holder"
import { Migrator } from "./common"

export default class LimitCleanupMigrator implements Migrator {
    onInstall(): void {
        // No action needed on install, limit options are not part of defaults anymore
    }

    async onUpdate(version: string): Promise<void> {
        // Clean up limit-related options starting from version where limit was removed
        if (version >= '3.7.0') {
            await this.cleanupLimitOptions()
        }
    }

    private async cleanupLimitOptions(): Promise<void> {
        const option = await optionHolder.get()

        // Check if any limit-related properties exist and clean them
        const limitProps = ['limitLevel', 'limitPassword', 'limitPrompt', 'limitVerifyDifficulty', 'limitReminder', 'limitReminderDuration']
        const hasLimitOptions = limitProps.some(prop => (option as any)[prop] !== undefined)

        if (hasLimitOptions) {
            // Remove limit-related properties by setting them to undefined
            const cleanupOptions: any = {}
            limitProps.forEach(prop => {
                if ((option as any)[prop] !== undefined) {
                    cleanupOptions[prop] = undefined
                }
            })

            // Use set to update options
            await optionHolder.set(cleanupOptions)
        }
    }
}