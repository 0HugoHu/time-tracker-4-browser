import { sendMsg2Runtime } from "@api/chrome/runtime"

function awaitDocumentReady() {
    if (document.readyState === 'complete') {
        return Promise.resolve()
    } else {
        return new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true })
        })
    }
}

const main = async () => {
    await awaitDocumentReady()
    sendMsg2Runtime('cs.onInjected')
}

main()
