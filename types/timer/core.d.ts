declare namespace timer.core {
    type Event = {
        start: number
        end: number
        url: string
        ignoreTabCheck: boolean
        /**
         * Used for run time tracking
         */
        host?: string
    }

    /**
     * The dimension to statistics
     */
    type Dimension =
        // Focus time
        | 'focus'
        // Visit count
        | 'time'
        // Run time
        | 'run'

    /**
     * The stat result of host
     *
     * @since 0.0.1
     */
    type Result = MakeOptional<{ [item in Dimension]: number }, 'run'>

    /**
     * The unique key of each data row
     */
    type RowKey = {
        host: string
        date: string
    }

    type Row = RowKey & Result

    /**
     * Enhanced row for real-time sync with conflict resolution
     * @since 3.7.0
     */
    type EnhancedRow = Row & {
        sessionId?: string
        lastModified?: number
        version?: number
        batchId?: string
    }
}