/**
 * Copyright (c) 2021 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import { sendMsg2Runtime } from "@api/chrome/runtime"
import { formatPeriodCommon } from "@util/time"
import { contentLogger } from "@util/logger"
import { t } from "./locale"

/**
 * Print info of today
 */
export default async function printInfo(host: string) {
    const waste = await sendMsg2Runtime<string, timer.core.Result>('cs.getTodayInfo', host)
    const { time, focus } = waste || {}

    const param = {
        time: `${time ?? '-'}`,
        focus: formatPeriodCommon(focus ?? 0),
        host,
    }
    const info0 = t(msg => msg.console.consoleLog, param)
    const info1 = t(msg => msg.console.closeAlert, { appName: t(msg => msg.meta.name) })
    contentLogger.info(info0)
    contentLogger.info(info1)
}