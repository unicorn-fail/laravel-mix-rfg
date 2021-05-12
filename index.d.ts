import { PathLike, Stats } from 'fs'
import { WatchOptions } from 'chokidar'

export type GlobPatternLike = string | string[]

// @todo Move RGF specific typings upstream to https://github.com/RealFaviconGenerator/rfg-api
export type RfgConflictValue = 'raise_error'|'override'|'keep_existing'

export interface RfgConfigSettings {
    compression?: 0|1|2|3|4|5
    errorOnImageTooSmall?: boolean
    htmlCodeFile?: boolean
    readmeFile?: boolean,
    scalingAlgorithm?: 'Mitchell'|'NearestNeighbor'|'Cubic'|'Bilinear'|'Lanczos'|'Spline'
    usePathAsIs?: boolean
}

export interface RfgConfigVersioning {
    paramName?: string
    paramValue?: string
}

export interface RfgConfigDesign {
    androidChrome?: {
        assets?: {
            legacyIcon?: boolean
            lowResolutionIcons?: boolean
        }
        backgroundColor?: string
        circleInnerMargin?: number|string
        keepPictureInCircle?: boolean
        manifest?: {
            name?: string
            display?: 'browser'|'standalone'
            existingManifest?: string
            onConflict?: RfgConflictValue
            orientation?: 'portrait'|'landscape'
            startUrl?: string
            themeColor?: string
        }
        margin?: string
        overlay?: boolean
        pictureAspect?: 'no_change'|'background_and_margin'|'shadow'

    }
    coast?: {
        pictureAspect?: 'no_change'|'background_and_margin'
    }
    desktopBrowser?: {}
    firefoxApp?: {
        backgroundColor?: string
        circleInnerMargin?: number|string
        keepPictureInCircle?: boolean
        manifest?: {
            appName?: string
            appDescription?: string
            developerName?: string
            developerUrl?: string
            existingManifest?: string
            onConflict?: RfgConflictValue
        }
        margin?: string
        overlay?: boolean
        pictureAspect?: 'no_change'|'circle'|'rounded_square'|'square'

    }
    ios?: {
        appName?: string
        assets?: {
            declare_only_default_icon?: boolean
            ios6_and_prior_icons?: boolean
            ios7_and_later_icons?: boolean
            precomposed_icons?: boolean
        }
        backgroundAndMargin?: string
        backgroundColor?: string
        margin?: number|string
        pictureAspect?: 'no_change'|'background_and_margin'
        startupImage?: string
    }
    openGraph?: {
        pictureAspect?: 'no_change'|'background_and_margin'
        backgroundColor?: string
        margin?: number|string
        ratio?: string
        siteUrl?: string
    }
    safariPinnedTab?: {
        pictureAspect?: 'no_change'|'silhouette'|'black_and_white'
        themeColor?: string
    }
    windows?: {
        appName?: string
        assets?: {
            windows_80_ie_10_tile?: boolean
            windows_10_ie_11_edge_tiles?: {
                small?: boolean
                medium?: boolean
                big?: boolean
                rectangle?: boolean
            }
        }
        backgroundColor?: string
        existingManifest?: string
        onConflict?: RfgConflictValue
        pictureAspect?: 'no_change'|'white_silhouette'
    }
    yandexBrowser?: {
        backgroundColor?: string
        manifest?: {
            errorOnOverride?: boolean
            existingManifest?: string
            showTitle?: boolean
            version?: string
        }

    }
}

// Based on https://github.com/RealFaviconGenerator/rfg-api/blob/a40346aaf4ebbb3361daf1cc6826a3ac126209f3/index.js#L243-L249
export interface RfgConfig {
    apiKey?: string
    iconsPath?: string | ((href: string, file: string, fileType: 'html'|'manifest') => string)
    design?: RfgConfigDesign
    masterPicture?: string
    settings?: RfgConfigSettings
    versioning?: false|RfgConfigVersioning
}

export interface LaravelMixRfgOptions {
    cache?: boolean | number | ((stat?: Stats) => boolean)
    config?: RfgConfig
    configFile?: string | string[]
    debug?: boolean
    dest?: string
    keep?: boolean
    htmlFiles?: GlobPatternLike
    htmlComment?: RegExp
    manifestFiles?: GlobPatternLike
    src?: PathLike | GlobPatternLike
    srcCwd?: string,
    watch?: false | WatchOptions
}

declare module 'laravel-mix' {
    export interface Api {
        rfg(options?: LaravelMixRfgOptions): Api
    }
}
