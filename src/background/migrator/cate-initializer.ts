/**
 * Copyright (c) 2025 @0HugoHu
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import cateService from "@service/cate-service"
import siteService from "@service/site-service"
import { Migrator } from "./common"

type InitialCate = {
    name: string
    hosts: string[]
}

const DEMO_ITEMS: InitialCate[] = [
    {
        name: 'Development',
        hosts: [
            'github.com',
            'stackoverflow.com',
        ],
    }, {
        name: 'Cloud Services',
        hosts: [
            'console.aws.amazon.com',
            'us-east-1.console.aws.amazon.com',
            'us-east-2.console.aws.amazon.com',
            'eu-west-1.console.aws.amazon.com',
            'us-west-2.console.aws.amazon.com',
            'signin.aws.amazon.com',
        ],
    }, {
        name: 'Work Tools',
        hosts: [
            // Amazon development tools
            'code.amazon.com',
            'build.amazon.com',
            'pipelines.amazon.com',
            'issues.amazon.com',
            'apollo.amazon.com',
            'mcm.amazon.com',
            'mcm.amazon.dev',
            'sim.amazon.com',
            'weblab.amazon.com',
            'sage.amazon.com',
            'sage.amazon.dev',
            // Amazon work platforms
            'datacentral.a2z.com',
            't.corp.amazon.com',
            'w.amazon.com',
            'monitorportal.amazon.com',
            'phonetool.amazon.com',
            'quip-amazon.com',
            'sushi.amazon.com',
            'cpjobui-na.amazon.com',
            'cpjobui-eu.amazon.com',
            'atoz.amazon.work',
            // Amazon infrastructure & ops
            'oncall.corp.amazon.com',
            'oncall.ai.amazon.dev',
            'retro.corp.amazon.com',
            'midway-auth.amazon.com',
            'i.amazon.com',
            'tiny.amazon.com',
            'kingpin.amazon.com',
            'is-it-down.amazon.com',
            'nexus.corp.amazon.com',
            'meetings.amazon.com',
            'gather.a2z.com',
            'console.harmony.a2z.com',
            'shepherd.a2z.com',
            'console.clickstream.amazon.com',
            'deployment-group.pipelines.a2z.com',
            'forecasts.cloudtune.a2z.com',
            'live-forecast-monitoring.cloudtune.amazon.dev',
            'cti.amazon.com',
            'fua.corp.amazon.com',
            'sas.corp.amazon.com',
            'policyengine.amazon.com',
            'conduit.security.a2z.com',
            'asr.security.amazon.dev',
            'alation.spektr.a2z.com',
            'fatals.amazon.com',
            // Amazon infrastructure endpoints
            'iad.merlon.amazon.dev',
            'toolbelt.irm.amazon.dev',
            'docs.hub.amazon.dev',
            'idp-integ.federate.amazon.com',
            // Amazon ORCA endpoints
            'pdx-o-orca.amazon.com',
            'pdx-t-orca.amazon.com',
            'sfo-ab-orca.amazon.com',
            'sfo-aj-orca.amazon.com',
            'sfo-v-orca.amazon.com',
        ],
    }, {
        name: 'Entertainment',
        hosts: [
            'www.youtube.com',
            'www.bilibili.com',
            'www.fifa.com',
            'auth.fifa.com',
            'access.tickets.fifa.com',
            'fifa-fwc26-us.tickets.fifa.com',
        ],
    }, {
        name: 'Gaming',
        hosts: [
            'act.hoyoverse.com',
        ],
    }, {
        name: 'Search & Info',
        hosts: [
            'www.google.com',
            'www.baidu.com',
        ],
    }, {
        name: 'Social Media',
        hosts: [
            'x.com',
            'twitter.com',
        ],
    }, {
        name: 'Productivity',
        hosts: [
            'www.deepl.com',
            'translate.google.com',
        ],
    }
]

async function initItem(item: InitialCate) {
    const { name, hosts } = item
    const cate = await cateService.add(name)
    const cateId = cate.id
    const siteKeys = hosts.map(host => ({ host, type: 'normal' } satisfies timer.site.SiteKey))
    await siteService.batchSaveCate(cateId, siteKeys)
}

export default class CateInitializer implements Migrator {
    async onInstall(): Promise<void> {
        for (const item of DEMO_ITEMS) {
            await initItem(item)
        }
    }

    onUpdate(version: string): void {
        version === '3.0.1' && this.onInstall()
    }
}