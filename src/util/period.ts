/**
 * Copyright (c) 2021 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { groupBy } from "./array"
import { MILL_PER_DAY, MILL_PER_MINUTE } from "./time"

export const MINUTE_PER_PERIOD = 15
export const PERIOD_PER_DATE = 24 * 60 / MINUTE_PER_PERIOD
export const MAX_PERIOD_ORDER = PERIOD_PER_DATE - 1
export const MILL_PER_PERIOD = MINUTE_PER_PERIOD * MILL_PER_MINUTE

export function keyOf(time: Date | number, order?: number): timer.period.Key {
    time = time instanceof Date ? time : new Date(time)
    const year = time.getFullYear()
    const month = time.getMonth() + 1
    const date = time.getDate()
    order = order === undefined
        ? time.getHours() * 4 + Math.floor(time.getMinutes() / MINUTE_PER_PERIOD)
        : order
    return { year, month, date, order }
}

export function copyKeyWith(old: timer.period.Key, newOrder: number): timer.period.Key {
    const { year, month, date } = old
    return { year, month, date, order: newOrder }
}

export function indexOf(key: timer.period.Key): number {
    if (!key) return 0
    const { year, month, date, order } = key
    return (year << 18)
        | (month << 14)
        | (date << 8)
        | order
}

export function compare(a: timer.period.Key, b: timer.period.Key): number {
    return indexOf(a) - indexOf(b)
}

export function keyBefore(key: timer.period.Key, orderCount: number): timer.period.Key {
    let order = key.order
    let decomposition = 0

    while (order < orderCount) {
        decomposition++
        order += PERIOD_PER_DATE
    }
    order = order - orderCount
    if (decomposition) {
        const newDate = new Date(startOfKey(key).getTime() - MILL_PER_DAY * decomposition)
        return keyOf(newDate, order)
    } else {
        return copyKeyWith(key, order)
    }
}

export function after(key: timer.period.Key, orderCount: number): timer.period.Key {
    const date = new Date(key.year, key.month - 1, key.date, 0, (key.order + orderCount) * MINUTE_PER_PERIOD, 1)
    return keyOf(date)
}

export function startOfKey(key: timer.period.Key): Date {
    return new Date(key.year, key.month - 1, key.date, 0, MINUTE_PER_PERIOD * key.order)
}

export function lastKeyOfLastDate(key: timer.period.Key): timer.period.Key {
    return keyBefore(key, key.order + 1)
}

export function getDateString(key: timer.period.Key) {
    return `${key.year}${key.month < 10 ? '0' : ''}${key.month}${key.date < 10 ? '0' : ''}${key.date}`
}

export function rowOf(endKey: timer.period.Key, duration?: number, milliseconds?: number): timer.period.Row {
    duration = duration || 1
    milliseconds = milliseconds || 0
    const date = getDateString(endKey)
    const endStart = startOfKey(endKey)
    const endTime = new Date(endStart.getTime() + MILL_PER_PERIOD)
    const startTime = duration === 1 ? endStart : new Date(endStart.getTime() - (duration - 1) * MILL_PER_PERIOD)
    return { startTime, endTime, milliseconds, date }
}

export function startOrderOfRow(row: timer.period.Row): number {
    return (row.startTime.getHours() * 60 + row.startTime.getMinutes()) / MINUTE_PER_PERIOD
}

/**
 * @param rows period rows
 * @returns [0, 12)
 */
export function calcMostPeriodOf2Hours(rows: timer.period.Result[]): number {
    const periodCount = rows?.length ?? 0
    // Order [0, 95]
    const averageTimePerPeriod: { [order: number]: number } = groupBy(rows,
        p => p.order,
        (grouped: timer.period.Result[]) => {
            const periodMills = grouped.map(p => p.milliseconds)
            if (!periodCount) {
                return 0
            }
            return Math.floor(periodMills.reduce((a, b) => a + b, 0) / periodCount)
        }
    )
    // Merged per 2 hours
    const averageTimePer2Hours: { [idx: number]: number } = groupBy(Object.entries(averageTimePerPeriod),
        ([order]) => Math.floor(parseInt(order) / 8),
        averages => averages.map(a => a[1]).reduce((a, b) => a + b, 0)
    )
    // The two most frequent online hours
    const most2Hour: number = parseInt(
        Object.entries(averageTimePer2Hours)
            .sort((a, b) => a[1] - b[1])
            .reverse()[0]?.[0]
    )
    return most2Hour
}

function generateOrderMap(data: timer.period.Row[], periodSize: number): Map<number, number> {
    const map: Map<number, number> = new Map()
    data.forEach(item => {
        const key = Math.floor(startOrderOfRow(item) / periodSize)
        const val = map.get(key) || 0
        map.set(key, val + item.milliseconds)
    })
    return map
}

function cvt2AverageResult(map: Map<number, number>, periodSize: number, dateNum: number): timer.period.Row[] {
    const result = []
    let period = keyOf(new Date(), 0)
    for (let i = 0; i < PERIOD_PER_DATE / periodSize; i++) {
        const key = period.order / periodSize
        const val = map.get(key) ?? 0
        const averageMill = Math.round(val / dateNum)
        result.push(rowOf(after(period, periodSize - 1), periodSize, averageMill))
        period = after(period, periodSize)
    }
    return result
}

export function averageByDay(data: timer.period.Row[], periodSize: number): timer.period.Row[] {
    if (!data?.length) return []
    const rangeStart = data[0]?.startTime
    const rangeEnd = data[data.length - 1]?.endTime
    const dateNum = (rangeEnd.getTime() - rangeStart.getTime()) / MILL_PER_DAY
    const map = generateOrderMap(data, periodSize)
    return cvt2AverageResult(map, periodSize, dateNum)
}
