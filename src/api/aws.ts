/**
 * Copyright (c) 2025 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { fetchGet, fetchPost, fetchPut } from "./http"

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

export type DownloadRequest = {
    startDate?: string
    endDate?: string
    clientId?: string
}

export type DownloadResponse = {
    success: boolean
    data: timer.core.Row[]
    count: number
}

export type ClientsResponse = {
    clients: timer.backup.Client[]
}

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
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
    const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
    const url = `${baseUrl}/sync`
    const headers = getHeaders(config, clientId)
    
    const body: SyncRequest = {
        clientId,
        rows,
        batchId
    }
    
    const response = await fetchPost(url, body, { headers })
    
    if (!response.ok) {
        const error = await response.text()
        throw new Error(`Upload failed: ${response.status} ${error}`)
    }
    
    return await response.json()
}

/**
 * Download data from AWS backend
 */
export async function downloadData(config: AwsConfig, clientId: string, request: DownloadRequest): Promise<DownloadResponse> {
    const params = new URLSearchParams()
    if (request.startDate) params.set('startDate', request.startDate)
    if (request.endDate) params.set('endDate', request.endDate)
    if (request.clientId) params.set('clientId', request.clientId)
    
    const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
    const url = `${baseUrl}/data?${params.toString()}`
    const headers = getHeaders(config, clientId)
    
    const response = await fetchGet(url, { headers })
    
    if (!response.ok) {
        const error = await response.text()
        throw new Error(`Download failed: ${response.status} ${error}`)
    }
    
    return await response.json()
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

/**
 * Update specific data records
 */
export async function updateData(config: AwsConfig, clientId: string, rows: timer.core.EnhancedRow[]): Promise<SyncResponse> {
    const baseUrl = config.apiEndpoint.endsWith('/') ? config.apiEndpoint.slice(0, -1) : config.apiEndpoint
    const url = `${baseUrl}/data`
    const headers = getHeaders(config, clientId)
    
    const body = {
        clientId,
        rows,
        batchId: `update_${Date.now()}`
    }
    
    const response = await fetchPut(url, body, { headers })
    
    if (!response.ok) {
        const error = await response.text()
        throw new Error(`Update failed: ${response.status} ${error}`)
    }
    
    return await response.json()
}