/**
 * Copyright (c) 2025 @0HugoHu
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

/**
 * Utility to generate smart client names based on system information
 */

type DeviceType = 'Desktop' | 'Laptop' | 'Tablet' | 'Mobile' | 'Unknown'
type BrowserInfo = {
    name: string
    version?: string
}

/**
 * Detect device type based on user agent and other hints
 */
function detectDeviceType(): DeviceType {
    let userAgent = ''
    try {
        if (typeof navigator !== 'undefined' && navigator.userAgent) {
            userAgent = navigator.userAgent.toLowerCase()
        }
    } catch {
        return 'Unknown'
    }

    // Check for mobile devices first
    if (/android|iphone|ipad|ipod|blackberry|windows phone/i.test(userAgent)) {
        if (/ipad|android(?!.*mobile)/i.test(userAgent)) {
            return 'Tablet'
        }
        return 'Mobile'
    }

    // Check for desktop vs laptop indicators
    // This is challenging as browsers do not expose this information directly
    // We will make educated guesses based on screen size and other factors
    try {
        if (typeof screen !== 'undefined' && screen.width >= 1920 && screen.height >= 1080) {
            return 'Desktop'
        }
    } catch {
        // screen is not available in background/service worker context
    }

    // Most modern devices that are not clearly desktop are likely laptops
    return 'Laptop'
}

/**
 * Get browser information
 */
function getBrowserInfo(): BrowserInfo {
    let userAgent = ''
    try {
        if (typeof navigator !== 'undefined' && navigator.userAgent) {
            userAgent = navigator.userAgent
        }
    } catch {
        return { name: 'Unknown' }
    }

    // Check for Chrome-based browsers (including Edge)
    if (userAgent.includes('Chrome')) {
        if (userAgent.includes('Edg')) {
            const match = userAgent.match(/Edg\/(\d+)/)
            return { name: 'Edge', version: match?.[1] }
        }
        const match = userAgent.match(/Chrome\/(\d+)/)
        return { name: 'Chrome', version: match?.[1] }
    }

    // Check for Firefox
    if (userAgent.includes('Firefox')) {
        const match = userAgent.match(/Firefox\/(\d+)/)
        return { name: 'Firefox', version: match?.[1] }
    }

    // Check for Safari
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        const match = userAgent.match(/Version\/(\d+)/)
        return { name: 'Safari', version: match?.[1] }
    }

    return { name: 'Unknown' }
}

/**
 * Get OS information
 */
function getOSInfo(): string {
    let userAgent = ''
    try {
        if (typeof navigator !== 'undefined' && navigator.userAgent) {
            userAgent = navigator.userAgent
        }
    } catch {
        return 'Unknown'
    }

    if (userAgent.includes('Windows')) return 'Windows'
    if (userAgent.includes('Mac')) return 'macOS'
    if (userAgent.includes('Linux')) return 'Linux'
    if (userAgent.includes('Android')) return 'Android'
    if (userAgent.includes('iOS')) return 'iOS'

    return 'Unknown'
}

/**
 * Generate a smart client name based on available system information
 */
export function generateSmartClientName(): string {
    const browser = getBrowserInfo()
    const deviceType = detectDeviceType()
    const os = getOSInfo()
    const year = new Date().getFullYear()

    // Try to get a meaningful name for the client
    let clientPrefix = 'Timer'

    // Try to get hostname from window location (for web pages)
    try {
        if (typeof window !== 'undefined' && window.location && window.location.hostname) {
            const hostname = window.location.hostname
            if (hostname && hostname !== 'localhost' && !hostname.includes('127.0.0.1')) {
                clientPrefix = hostname.split('.')[0] || 'Timer'
            }
        }
    } catch {
        // Fallback to Timer - window/location not available in background context
    }

    // Try to get computer name from navigator if available
    try {
        if (typeof navigator !== 'undefined') {
            // Some browsers provide platform-specific info
            const platform = (navigator as any).platform
            if (platform && typeof platform === 'string') {
                // Extract meaningful info from platform string
                if (platform.includes('Win')) {
                    clientPrefix = 'Windows-PC'
                } else if (platform.includes('Mac')) {
                    clientPrefix = 'Mac'
                } else if (platform.includes('Linux')) {
                    clientPrefix = 'Linux-PC'
                }
            }
        }
    } catch {
        // Ignore errors - navigator might not be available or accessible
    }

    // Build name components with better defaults
    const components = [
        clientPrefix,
        os !== 'Unknown' ? os : undefined,
        browser.name !== 'Unknown' ? browser.name : undefined,
        deviceType !== 'Unknown' && deviceType !== 'Laptop' ? deviceType : undefined, // Skip Laptop as it's assumed
        year.toString()
    ].filter(Boolean)

    const finalName = components.join('-')

    // Ensure the name is not too long and is filesystem-safe
    return finalName
        .replace(/[^a-zA-Z0-9-_]/g, '-')  // Replace special chars with dashes
        .replace(/-+/g, '-')              // Remove multiple consecutive dashes
        .replace(/^-|-$/g, '')            // Remove leading/trailing dashes
        .substring(0, 50)                 // Limit length
}

/**
 * Get detailed system information for debugging/display
 */
export function getSystemInfo(): {
    browser: BrowserInfo
    os: string
    deviceType: DeviceType
    userAgent: string
    screenResolution: string
    timezone: string
} {
    let screenResolution = 'Unknown'
    try {
        if (typeof screen !== 'undefined') {
            screenResolution = `${screen.width}x${screen.height}`
        }
    } catch {
        // screen is not available in background/service worker context
        screenResolution = 'Not available in background'
    }

    let userAgent = 'Unknown'
    let timezone = 'Unknown'

    try {
        if (typeof navigator !== 'undefined' && navigator.userAgent) {
            userAgent = navigator.userAgent
        }
    } catch {
        // navigator not available
    }

    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        // Intl not available or accessible
        timezone = 'Unknown'
    }

    return {
        browser: getBrowserInfo(),
        os: getOSInfo(),
        deviceType: detectDeviceType(),
        userAgent,
        screenResolution,
        timezone
    }
}