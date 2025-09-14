/**
 * Copyright (c) 2024 Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */
import { ElScrollbar } from "element-plus"
import { defineComponent, type StyleValue } from "vue"
import BackupOption from "../Option/components/BackupOption"
import ContentContainer from "../common/ContentContainer"

const _default = defineComponent(() => {
    return () => (
        <ElScrollbar height="100%" style={{ width: '100%' } satisfies StyleValue}>
            <ContentContainer>
                <BackupOption />
            </ContentContainer>
        </ElScrollbar>
    )
})


export default _default