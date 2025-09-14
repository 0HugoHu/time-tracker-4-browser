/**
 * Copyright (c) 2021-present Hengyang Zhang
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

import metaService from "@service/meta-service"
import { type App } from "vue"
import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router"
import { ANALYSIS_ROUTE, DASHBOARD_ROUTE, MERGE_ROUTE, OPTION_ROUTE, REPORT_ROUTE } from "./constants"

const dataRoutes: RouteRecordRaw[] = [
    {
        path: '/data',
        redirect: DASHBOARD_ROUTE,
    },
    // Needn't nested router
    {
        path: DASHBOARD_ROUTE,
        component: () => import('../components/Dashboard')
    },
    {
        path: REPORT_ROUTE,
        component: () => import('../components/Report')
    }, {
        path: ANALYSIS_ROUTE,
        component: () => import('../components/Analysis')
    }, {
        path: '/data/manage',
        component: () => import('../components/DataManage')
    }, {
        path: '/data/backup-sync',
        component: () => import('../components/BackupSync')
    }
]

const behaviorRoutes: RouteRecordRaw[] = [
    {
        path: '/behavior',
        redirect: '/behavior/habit'
    }, {
        path: '/behavior/habit',
        component: () => import('../components/Habit'),
    }
]

const additionalRoutes: RouteRecordRaw[] = [
    {
        path: '/additional',
        redirect: '/additional/whitelist'
    }, {
        path: '/additional/site-manage',
        component: () => import('../components/SiteManage')
    }, {
        path: '/additional/whitelist',
        component: () => import('../components/Whitelist')
    }, {
        path: MERGE_ROUTE,
        component: () => import('../components/RuleMerge')
    }, {
        path: OPTION_ROUTE,
        component: () => import('../components/Option')
    }
]

const otherRoutes: RouteRecordRaw[] = [
    {
        path: '/other',
        redirect: '/other/about'
    }, {
        path: '/other/about',
        component: () => import('../components/About'),
    }
]

const routes: RouteRecordRaw[] = [
    { path: '/', redirect: DASHBOARD_ROUTE },
    ...dataRoutes,
    ...behaviorRoutes,
    ...additionalRoutes,
    ...otherRoutes,
    { path: '/:W+', redirect: DASHBOARD_ROUTE },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
})

async function handleChange() {
    await router.isReady()
    const current = router.currentRoute.value.fullPath
    current && metaService.increaseApp(current)
    router.afterEach((to, from, failure: Error | void) => {
        if (failure || to.fullPath === from.fullPath) return
        metaService.increaseApp(to.fullPath)
    })
}

export default (app: App) => {
    app.use(router)
    handleChange()
}
