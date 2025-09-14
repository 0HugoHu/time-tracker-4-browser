/**
 * Copyright (c) 2024 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

/**
 * Enhanced logging utility for the timer extension
 * Handles logging across different execution contexts (content scripts, background, popup, etc.)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = 'content' | 'background' | 'popup' | 'app' | 'side'

interface LogEntry {
    timestamp: number
    level: LogLevel
    context: LogContext
    message: string
    data?: any
    url?: string
    host?: string
}

class Logger {
    private context: LogContext
    private isEnabled: boolean = true

    constructor(context: LogContext) {
        this.context = context
    }

    /**
     * Enable or disable logging
     */
    setEnabled(enabled: boolean) {
        this.isEnabled = enabled
    }

    /**
     * Log a debug message
     */
    debug(message: string, data?: any) {
        this.log('debug', message, data)
    }

    /**
     * Log an info message
     */
    info(message: string, data?: any) {
        this.log('info', message, data)
    }

    /**
     * Log a warning message
     */
    warn(message: string, data?: any) {
        this.log('warn', message, data)
    }

    /**
     * Log an error message
     */
    error(message: string, data?: any) {
        this.log('error', message, data)
    }

    /**
     * Core logging method
     */
    private log(level: LogLevel, message: string, data?: any) {
        if (!this.isEnabled) return

        const timestamp = Date.now()
        const levelIcon = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'info' ? 'ℹ️' : '🔍'
        const prefix = `[Timer:${this.context}:${level.toUpperCase()}${levelIcon}]`
        const fullMessage = `${prefix} ${message}`

        // Get current page info if available
        let url: string | undefined
        let host: string | undefined
        try {
            if (typeof window !== 'undefined' && window.location) {
                url = window.location.href
                host = window.location.host
            }
        } catch {
            // Not available in all contexts
        }

        const entry: LogEntry = {
            timestamp,
            level,
            context: this.context,
            message: fullMessage,
            data,
            url,
            host
        }

        // Always log to browser console with appropriate level
        this.logToBrowserConsole(level, fullMessage, data)

        // For content scripts, also add helpful context
        if (this.context === 'content' && host) {
            console.log(`${prefix} 📍 Website: ${host}`)
        }

        // Store log entry for potential centralized viewing
        this.storeLogEntry(entry)
    }

    /**
     * Log to browser console with appropriate level
     * Uses console.log for errors to avoid Chrome extension error logging
     */
    private logToBrowserConsole(level: LogLevel, message: string, data?: any) {
        // Use console.log for all levels to avoid Chrome extension error page logging
        // The message prefix already indicates the log level
        const consoleMethod = console.log

        if (data !== undefined) {
            consoleMethod(message, data)
        } else {
            consoleMethod(message)
        }
    }

    /**
     * Store log entry for potential centralized viewing
     * This is optional and could be used for a logs viewer in the extension
     */
    private storeLogEntry(entry: LogEntry) {
        try {
            // Only store recent logs to avoid memory issues
            const maxLogs = 100
            const storageKey = 'timer_logs'

            // Try to access localStorage (may not be available in all contexts)
            if (typeof localStorage !== 'undefined') {
                const existingLogs = JSON.parse(localStorage.getItem(storageKey) || '[]')
                const updatedLogs = [...existingLogs, entry].slice(-maxLogs)
                localStorage.setItem(storageKey, JSON.stringify(updatedLogs))
            }
        } catch {
            // localStorage not available or quota exceeded - ignore
        }
    }

    /**
     * Get stored logs (for debugging/admin purposes)
     */
    static getStoredLogs(): LogEntry[] {
        try {
            if (typeof localStorage !== 'undefined') {
                return JSON.parse(localStorage.getItem('timer_logs') || '[]')
            }
        } catch {
            // ignore
        }
        return []
    }

    /**
     * Clear stored logs
     */
    static clearStoredLogs(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('timer_logs')
            }
        } catch {
            // ignore
        }
    }

    /**
     * Create a logger for specific context with helpful instructions
     */
    static createContextLogger(context: LogContext): Logger {
        const logger = new Logger(context)

        // For content context, add helpful instruction on first use
        if (context === 'content') {
            logger.info('Time tracking logs appear here. Open developer tools on the website (F12) to see all logs.')
        }

        return logger
    }
}

// Create context-specific loggers
export const contentLogger = Logger.createContextLogger('content')
export const backgroundLogger = Logger.createContextLogger('background')
export const popupLogger = Logger.createContextLogger('popup')
export const appLogger = Logger.createContextLogger('app')
export const sideLogger = Logger.createContextLogger('side')

// Export default logger based on context detection
export function getContextLogger(): Logger {
    // Try to detect context automatically
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            const url = window?.location?.href
            if (url?.includes('popup.html')) return popupLogger
            if (url?.includes('app.html')) return appLogger
            if (url?.includes('side.html')) return sideLogger

            // Check if we're in background context
            if (!window || !document) return backgroundLogger

            // Default to content script context
            return contentLogger
        }
    } catch {
        // fallback
    }

    return new Logger('app')
}

export default Logger