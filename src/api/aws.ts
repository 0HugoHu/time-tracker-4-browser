/**
 * Copyright (c) 2025 @0HugoHu
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { fetchGet, fetchPost } from "./http"
import { getContextLogger } from "@util/logger"

export type AwsConfig = {
    apiEndpoint: string
    websocketEndpoint: string
    apiKey: string
    region: string
}

export type SyncRequest = {
    clientId: string
    rows: timer.core.EnhancedRow[]
    batchId: string
}

export type SyncResponse = {
    success: boolean
    processed: number
    successful: number
    failed: number
    results: SyncResult[]
}

export type SyncResult = {
    success?: boolean
    error?: string
    pk?: string
    version?: number
    conflicts?: ConflictInfo[]
    row?: timer.core.EnhancedRow
}

export type ConflictInfo = {
    type: 'session_conflict' | 'timestamp_conflict'
    clientId: string
    sessionId: string
    rejected?: boolean
    reason?: string
    overwritten?: {
        focus: number
        time: number
        lastModified: number
    }
}


export type ClientsResponse = {
    clients: timer.backup.Client[]
}

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation()
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            
            if (attempt === maxRetries) {
                break
            }
            
            // Don't retry on authentication errors (4xx)
            if (lastError.message.includes('HTTP 4')) {
                break
            }
            
            getContextLogger().debug(`AWS API attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
            await sleep(RETRY_DELAY_MS * attempt)
        }
    }
    
    throw lastError || new Error('Operation failed after retries')
}

function getHeaders(config: AwsConfig, clientId?: string): Record<string, string> {
    const headers: Record<string, string> = {
        ...DEFAULT_HEADERS,
        'X-Api-Key': config.apiKey,
    }
    
    if (clientId) {
        headers['X-Client-Id'] = clientId
    }
    
    return headers
}

/**
 * Upload data rows to AWS backend
 */
export async function uploadData(config: AwsConfig, clientId: string, rows: timer.core.EnhancedRow[], batchId: string): Promise<SyncResponse> {
    if (!config.apiEndpoint || !config.apiKey) {
        throw new Error('AWS configuration incomplete: missing apiEndpoint or apiKey')
    }
    
    if (!clientId || !rows || rows.length === 0) {
        throw new Error('Invalid upload parameters: missing clientId or rows')
    }
    
    const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
    const url = `${baseUrl}/sync`
    const headers = getHeaders(config, clientId)
    
    const body: SyncRequest = {
        clientId,
        rows,
        batchId
    }
    
    return await withRetry(async () => {
        const response = await fetchPost(url, body, { headers })
        
        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Upload failed: HTTP ${response.status} - ${errorText}`)
        }
        
        return await response.json()
    })
}


/**
 * List all clients
 */
export async function listClients(config: AwsConfig, clientId: string): Promise<ClientsResponse> {
    const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
    const url = `${baseUrl}/sync`
    const headers = getHeaders(config, clientId)
    
    const response = await fetchGet(url, { headers })
    
    if (!response.ok) {
        const error = await response.text()
        throw new Error(`List clients failed: ${response.status} ${error}`)
    }
    
    return await response.json()
}

/**
 * Test API connectivity and authentication
 */
export async function testConnection(config: AwsConfig, clientId: string): Promise<string | undefined> {
    try {
        const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
        const url = `${baseUrl}/sync`
        const headers = getHeaders(config, clientId)
        
        const response = await fetchGet(url, { headers })
        
        if (response.ok) {
            return undefined // Success
        } else {
            const error = await response.text()
            return `HTTP ${response.status}: ${error}`
        }
    } catch (error) {
        return error instanceof Error ? error.message : 'Connection failed'
    }
}

