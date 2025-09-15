import { handleError } from "./common"
import { getContextLogger } from "@util/logger"

export function getRuntimeId(): string {
    return chrome.runtime.id
}

export function getRuntimeName(): string {
    return chrome.runtime.getManifest().name
}

export function sendMsg2Runtime<T = any, R = any>(code: timer.mq.ReqCode, data?: T): Promise<R | undefined> {
    // Fix proxy data failed to serialized in Firefox
    if (data !== undefined) {
        data = JSON.parse(JSON.stringify(data))
    }
    const request: timer.mq.Request<T> = { code, data }
    return new Promise((resolve, reject) => {
        try {
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                // Only log once per minute to avoid spam
                const now = Date.now()
                const lastWarning = (window as any).__lastContextWarning || 0
                if (now - lastWarning > 60000) { // 60 seconds
                    getContextLogger().debug('Extension context invalidated - tracking paused. Reload extension to resume.')
                    ;(window as any).__lastContextWarning = now
                }
                resolve(undefined)
                return
            }
            
            chrome.runtime.sendMessage(request, (response: timer.mq.Response<R>) => {
                const lastError = handleError('sendMsg2Runtime')
                
                // Check if context was invalidated during the call
                if (lastError?.includes('Extension context invalidated') || lastError?.includes('message port closed')) {
                    // Use same throttled logging
                    const now = Date.now()
                    const lastWarning = (window as any).__lastContextWarning || 0
                    if (now - lastWarning > 60000) {
                        getContextLogger().debug('Extension context invalidated - tracking paused. Reload extension to resume.')
                        ;(window as any).__lastContextWarning = now
                    }
                    resolve(undefined)
                    return
                }
                
                const resCode = response?.code
                resCode === 'fail' && reject(new Error(response?.msg || 'Unknown error'))
                resCode === 'success' && resolve(response.data)
            })
        } catch (e) {
            const errorMsg = (e as Error)?.message || 'Unknown error'
            
            // Handle context invalidation gracefully
            if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
                // Use same throttled logging
                const now = Date.now()
                const lastWarning = (window as any).__lastContextWarning || 0
                if (now - lastWarning > 60000) {
                    getContextLogger().debug('Extension context invalidated - tracking paused. Reload extension to resume.')
                    ;(window as any).__lastContextWarning = now
                }
                resolve(undefined)
                return
            }
            
            reject('Failed to send message: ' + errorMsg)
        }
    })
}

export function onRuntimeMessage<T = any, R = any>(handler: ChromeMessageHandler<T, R>): void {
    // Important: Exercise caution
    // Cannot use await/async in callback parameter
    chrome.runtime.onMessage.addListener((message: timer.mq.Request<T>, sender: chrome.runtime.MessageSender, sendResponse: timer.mq.Callback<R>) => {
        handler(message, sender).then((response: timer.mq.Response<R>) => {
            if (response.code === 'ignore') return
            sendResponse(response)
        })
        // 'return true' will force chrome to wait for the response processed in the above promise.
        // @see https://github.com/mozilla/webextension-polyfill/issues/130
        return true
    })
}

export function onInstalled(handler: (reason: ChromeOnInstalledReason) => void): void {
    chrome.runtime.onInstalled.addListener(detail => handler(detail.reason))
}

export function getVersion(): string {
    return chrome.runtime.getManifest().version
}

export function setUninstallURL(url: string): Promise<void> {
    return new Promise(resolve => chrome.runtime.setUninstallURL(url, resolve))
}

/**
 * Get the url of this extension
 *
 * @param path The path relative to the root directory of this extension
 */
export function getUrl(path: string): string {
    return chrome.runtime.getURL(path)
}

export async function isAllowedFileSchemeAccess(): Promise<boolean> {
    const res = await chrome.extension?.isAllowedFileSchemeAccess?.()
    return !!res
}