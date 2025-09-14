import menuMessages, { type MenuMessage } from "../app/menu"
import calendarMessages, { type CalendarMessage } from "../common/calendar"
import metaMessages, { type MetaMessage } from "../common/meta"
import { merge, type MessageRoot } from "../merge"
import consoleMessages, { type ConsoleMessage } from "./console"
import modalMessages, { type ModalMessage } from "./modal"

export type CsMessage = {
    console: ConsoleMessage
    modal: ModalMessage
    meta: MetaMessage
    menu: MenuMessage
    calendar: CalendarMessage
}

const CHILD_MESSAGES: MessageRoot<CsMessage> = {
    console: consoleMessages,
    modal: modalMessages,
    meta: metaMessages,
    menu: menuMessages,
    calendar: calendarMessages,
}

const _default = merge<CsMessage>(CHILD_MESSAGES)

export default _default