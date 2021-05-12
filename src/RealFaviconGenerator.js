// Node.js
const {
  copyFile,
  mkdir,
  readdir,
  rm,
  readFile,
  stat,
  writeFile,
  unlink,
} = require('fs/promises')
const { createWriteStream, Stats } = require('fs')
const path = require('path')
const https = require('https')

// Modules.
const chokidar = require('chokidar')
const findCacheDir = require('find-cache-dir')
const hasha = require('hasha')
const glob = require('matched')
const File = require('laravel-mix/src/File')
const Log = require('laravel-mix/src/Log')
const rfg = require('rfg-api').init()
const termImg = require('term-img')
const terminalLink = require('terminal-link')

// Local.
const {
  calculatePercentage,
  cleanDir,
  maskString,
  pathExists,
  relativePath,
  replaceAsync
} = require('./util')

const { Mix } = global
const rfgIconsPathToken = '{{RFG-ICONS-PATH-CALLBACK}}'
const rfgIconsPathTokenRegEx = new RegExp(rfgIconsPathToken + '([^"]+)', 'gm')

const privates = new WeakMap()

const RfgDefaultConfig = {
  design: {}
}

class RealFaviconGenerator {

  assets = []
  defaultOptions = {
    cache: true,
    config: undefined,
    configFile: '?(.)+(rfg|rfgrc|rfg.config)+(.js|.json)',
    debug: undefined,
    dest: 'favicons',
    keep: undefined,
    htmlFiles: undefined,
    htmlComment: /([\r\n\s\t]*(?:<!--|\{#|\{\{--)[\s~_-]*(?:RFG|RealFaviconGenerator|Real Favicon Generator)[\s~_-]*(?:start|end)[\s~_-]*(?:-->|#\}|--\}\})[\r\n\s\t]*)/i,
    manifestFiles: '+(manifest.json|*.webmanifest|+(browserconfig|ieconfig).xml)',
    src: [
      // Look in srcCwd (process.cwd() by default).
      '*favicon*.+(ico|png|jpeg|jpg|gif|svg)',

      // Look in sub-folder of srcCwd that might contain a favicon.
      '+(img|image|images|favicon|favicons)/*favicon*.+(ico|png|jpeg|jpg|gif|svg)',
    ],
    srcCwd: undefined,

    // Watch options or false, if plugin should not watch.
    watch: {},
  }
  isBeingWatched = false
  percent = 0

  constructor(plugin) {
    privates.set(this, {
      compilation: undefined,
    })

    /** @type {LaravelMixRfgPlugin} */
    this.plugin = plugin
  }

  async copyDir(src, dest, message = 'Copying file', showSource = true) {
    const files = await readdir(src, { withFileTypes: true })
    await mkdir(dest, { recursive: true })
    for (let i = 0, l = files.length; i < l; i++) {
      const file = files[i]
      const srcPath = path.join(src, file.name)
      const destPath = path.join(dest, file.name)
      if (file.isDirectory()) {
        await this.copyDir(srcPath, destPath, message)
      }
      else {
        const percent = calculatePercentage(l, i, this.percent)
        await this.plugin.progress(percent, message, showSource ? `${relativePath(srcPath)} -> ${relativePath(destPath)}` : relativePath(destPath))
        await copyFile(srcPath, destPath)
        this.assets.push(new File(path.resolve(dest, destPath)))
      }
    }
  }

  async doRequest(destination) {
    const config = await this.getConfig()

    this.setMinimumPercentage(50)

    await this.plugin.progress(this.percent, 'Generating favicons', true)
    return new Promise((resolve) => rfg.generateFavicon(config, destination, (error, json) => {
      if (error) {
        if (this.options.debug) {
          throw new Error(`[REQUEST]:\n\n${JSON.stringify(config, null, 4)}\n\n[RESPONSE]:\n\n${JSON.stringify(json, null, 4)}`)
        }
        else {
          throw new Error(`The RealFaviconGenerator API request failed, enable "debug" in the configuration to display the request and response output.`)
        }
      }

      resolve(json)
    }))
  }

  async generateFavicons() {
    this.percent = 0

    this.json = await this.request()

    this.setMinimumPercentage(80)
    await this.processManifestFiles(this.json)

    this.setMinimumPercentage(90)
    await this.processHtmlFiles(this.json)
  }

  async getConfigFiles() {
    if (this.configFiles) {
      return this.configFiles
    }

    await this.increaseProgress('Discovering configuration')

    const files = await glob.promise(this.options.configFile, {
      absolute: true,
      dot: true,
      nodir: true,
      matchBase: true
    })

    const configFiles = new Map()
    if (configFiles.length) {
      for (let i = 0, l = files.length; i < l; i++) {
        const file = files[i]

        try {
          const percent = calculatePercentage(l, i, this.percent)
          await this.plugin.progress(percent, 'Loading configuration', relativePath(file))

          let config = require(file)

          if (typeof config === 'function') {
            config = config.call()
          }

          if (typeof config !== 'object') {
            this.plugin.debug(`Unable to load configuration file ${relativePath(file)}, must be an object or function that returns an object. Got instead: ${JSON.stringify(config, null, 4)}`)
            continue
          }

          configFiles.set(file, config)
        }
        catch (fileErr) {
          this.plugin.debug(`Unable to load configuration file ${relativePath(file)}, skipping:\n\n${fileErr.stack || fileErr.message}`)
        }
      }
    }
    else {
      await this.increaseProgress('No configuration files detected')
    }

    return this.configFiles = configFiles
  }

  async getConfig() {
    if (this.config) {
      return this.config
    }

    const configFiles = await this.getConfigFiles()

    this.setMinimumPercentage(20)
    await this.increaseProgress('Processing configuration')

    // Set the master picture from the given source favicon.
    const src = await this.getSourceFile()
    let masterPicture = {}
    if (rfg.isUrl(src)) {
      masterPicture.type = 'url'
      masterPicture.url = src
    }
    else if (await pathExists(src)) {
      masterPicture.type = 'inline'
      masterPicture.content = rfg.fileToBase64Sync(src)
    }

    /** @type {RfgConfig} */
    const config = {
      // Use any configuration found from files.
      ...([...configFiles.values()]).reduce((r, o) => ({...r, ...o}), {...RfgDefaultConfig}),

      // Merge instance option; superseding configuration file.
      ...this.options.config,

      // Explicitly override any masterPicture provided as this is
      // automatically determined from the source file above.
      masterPicture,
    }

    if (!config.apiKey) {
      // Allow API keu to be passed via the environment.
      const apiKey = process.env.RFG_API_KEY || ''
      if (apiKey) {
        config.apiKey = apiKey
      }
      else {
        const apiKeyConfig = { apiKey: 'REPLACE WITH API KEY' }
        throw new Error([
          'To use RealFaviconGenerator, an "apiKey" must be provided. Visit https://realfavicongenerator.net/api to request one.',
          'Once you have received an API key, set it in one of the following ways:',
          '',
          'Environmental variable (only available for the API key):',
          '',
          `\tRFG_API_KEY='REPLACE WITH API KEY'`,
          '',
          '',
          'JSON configuration file (rfg.config.json):',
          '',
          `\t${JSON.stringify(apiKeyConfig, null, 4)
            .replace(/([\r\n]+)/g, '$1\t')
            .trimEnd()}`,
          '',
          '',
          'JS module configuration file (rfg.config.js):',
          '',
          '\t/** @type {import(\'laravel-mix-rfg\').RfgConfig} */',
          `\tmodule.exports = ${JSON.stringify(apiKeyConfig, null, 4)
            .replace(/"([^"]+)":/g, '$1:')
            .replace(/([\r\n]+)/g, '$1\t')
            .trimEnd()}`,
          '',
          '',
          'Laravel Mix RFG plugin "config" option:',
          '',
          `\tmix.${this.plugin.name()}(${JSON.stringify({ config: apiKeyConfig }, null, 4)
            .replace(/"([^"]+)":/g, '$1:')
            .replace(/([\r\n]+)/g, '$1\t')
            .trimEnd()})`,
          '',
          '',
        ].join('\n'))
      }
    }

    // Ensure there is at least one design to generate.
    if (!Object.keys(config.design).length) {
      throw new Error('To use RealFaviconGenerator, one or more "design" sections must be provided. Visit https://realfavicongenerator.net/api/non_interactive_api#favicon_design')
    }

    // Ensure iconsPath is set to a special token when a function is
    // passed.
    if (typeof config.iconsPath === 'function') {
      this.iconsPathCallback = config.iconsPath
      config.iconsPath = rfgIconsPathToken
      config.settings.usePathAsIs = true
    }

    this.config = rfg.createRequest(config)

    await this.increaseProgress(`Initialized configuration (API Key: ${maskString(this.config.api_key)})`)

    return this.config
  }

  async getDestination() {
    if (this.destination) {
      return this.destination
    }

    const { dest } = this.options

    await mkdir(dest, { recursive: true })

    return this.destination = path.resolve(dest)
  }

  async getSourceFile() {
    if (this.favicon) {
      return this.favicon
    }

    let favicons = []

    if (await pathExists(this.options.src)) {
      favicons.push(this.options.src)
    }
    else {
      const options = { absolute: true, nodir: true }
      if (this.options.srcCwd) {
        options.cwd = this.options.srcCwd
      }
      favicons.push(...await glob.promise(this.options.src, options))
    }

    if (!favicons.length) {
      throw new Error('No favicons could be found, try explicitly specifying a file path for the "favicon" option.')
    }

    return this.favicon = favicons.shift()
  }

  async increaseProgress(message, details, increment = 5) {
    this.percent += increment
    await this.plugin.progress(this.percent, message, details)
  }

  async injectFavicons(content, favicon) {
    return new Promise((resolve, reject) => {
      const { html_code, overlapping_markups } = favicon

      // Determine if file uses comments to denote start/end to be injected.
      const split = content.split(this.options.htmlComment)
      if (split.length === 5) {
        const matches = split[1].match(/[\r\n]*([\s\t]*)[\r\n]*$/)
        const spacing = matches && matches[1]
        if (spacing) {
          split[2] = html_code.replace(/(\n|\r\n)/g, `$1${spacing}`)
        }
        else {
          split[2] = html_code
        }
        return resolve(split.join(''))
      }

      const args = {}
      if (this.options.keep !== undefined) {
        args.keep = this.options.keep
      }
      if (overlapping_markups) {
        args.remove = overlapping_markups
      }

      // Otherwise, let RFG inject it.
      rfg.injectFaviconMarkups(content, html_code, args, (error, html) => {
        if (error) {
          reject(error)
        }
        resolve(html)
      })
    })
  }

  async isCacheExpired(stat) {
    let { cache } = this.options

    // Allow cache option to be a callback, must return a boolean.
    if (typeof cache === 'function') {
      return !!cache.call(undefined, stat)
    }

    const ttl = ~~parseInt(`${cache}`)
    if (stat instanceof Stats && ttl > 0) {
      return (Date.now() - stat.mtime.getTime()) > (ttl * 1000)
    }

    // A positive cache option indicates that the cache should never expire.
    if (cache) {
      return false
    }

    // A negative cache option indicates that the cache should always expire.
    return true
  }

  async processHtmlFiles(json) {
    this.setMinimumPercentage(90)

    const htmlFiles = Array.from([].concat(this.options.htmlFiles))
      .filter(Boolean)

    for (let i = 0, l = htmlFiles.length; i < l; i++) {
      let file = htmlFiles[i]

      const percent = calculatePercentage(l, i, this.percent)
      await this.plugin.progress(percent, 'Processing HTML file', relativePath(file))

      if (!await pathExists(file)) {
        await writeFile(file, '', 'utf-8')
      }

      file = path.resolve(file)

      let content = await readFile(file, 'utf-8')

      content = await this.injectFavicons(content, json.favicon)

      if (this.iconsPathCallback) {
        content = await replaceAsync(content, rfgIconsPathTokenRegEx, async (match, href) => this.iconsPathCallback.call(this, href, file, 'html'))
      }

      await writeFile(file, content, 'utf-8')

      this.assets.push(new File(file))
    }
  }

  async processManifestFiles() {
    if (!this.iconsPathCallback) {
      return
    }

    this.setMinimumPercentage(80)

    const files = await glob.promise(this.options.manifestFiles, {
      absolute: true,
      cwd: await this.getDestination(),
      nodir: true,
      matchBase: true,
    })

    for (let i = 0, l = files.length; i < l; i++) {
      const file = files[i]

      const percent = calculatePercentage(l, i, this.percent)
      await this.plugin.progress(percent, 'Processing manifest file', relativePath(file))

      let contents = await readFile(file, 'utf-8')

      contents = await replaceAsync(contents, rfgIconsPathTokenRegEx, async (match, href) => this.iconsPathCallback.call(this, href, file, 'manifest'))

      await writeFile(file, contents)
    }
  }

  async request() {
    const destination = await this.getDestination()

    // Immediately do a request if cache has been explicitly disabled.
    if (!this.options.cache) {
      return this.doRequest(destination)
    }

    const config = await this.getConfig()
    const configHash = await hasha.async(JSON.stringify(config), { algorithm: 'sha1' })

    await this.increaseProgress('Checking for cached response', configHash)

    const thunk = findCacheDir({ name: this.plugin.name(true), thunk: true })
    const cacheJson = thunk(configHash, 'response.json')
    const cacheFiles = thunk(configHash, 'files')
    const cacheExists = await pathExists(cacheJson) && await pathExists(cacheFiles)

    let json
    if (cacheExists && !await this.isCacheExpired(await stat(cacheJson))) {
      try {
        json = require(cacheJson)
        this.setMinimumPercentage(50)
        await this.plugin.progress(this.percent, 'Found cached response', relativePath(cacheJson))
      }
      catch (error) {
        await this.increaseProgress('Unable to parse cached response', relativePath(cacheJson))
      }
    }

    if (!json) {
      await rm(thunk(configHash), { force: true, recursive: true })

      json = await this.doRequest(cacheFiles)

      await writeFile(cacheJson, JSON.stringify(json), 'utf-8')
    }

    const previewBaseName = path.basename(json.preview_picture_url)
    const previewFile = path.join(cacheFiles, previewBaseName)

    await new Promise((resolve) => {
      const previewFileStream = createWriteStream(previewFile)
      https
        .get(json.preview_picture_url, function (response) {
          response.pipe(previewFileStream)
          previewFileStream.on('finish', () => previewFileStream.close(resolve))
        })
        .on('error', async (err) => {
          await unlink(previewFile)
          this.plugin.debug(err)
        })
    })

    await this.increaseProgress('Cleaning', relativePath(destination))
    await cleanDir(destination)

    this.setMinimumPercentage(70)
    await this.copyDir(cacheFiles, destination, 'Saving asset', false)

    return json
  }

  setOptions(options) {
    this.options = {
      ...this.defaultOptions,
      ...options,
    }
  }

  async run() {
    // Ignore execution while watching.
    if (this.isBeingWatched || Mix.isWatching()) {
      return
    }

    await this.generateFavicons()
  }

  setCompilation(compilation) {
    const _ = privates.get(this)
    _.compilation = compilation
  }

  setMinimumPercentage(percent) {
    if (this.percent < percent) {
      this.percent = percent
    }
  }

  async watch(usePolling = false) {
    // Ignore execution while watching, not in watch mode or explicitly
    // disabled.
    if (this.isBeingWatched || !Mix.isWatching() || !this.options.watch) {
      return
    }

    const src = await this.getSourceFile()
    if (!src) {
      return
    }

    const watcher = chokidar
      .watch(src, {
        ignoreInitial: await pathExists(this.options.dest),
        ...this.options.watch,
        usePolling,
      })
      .on('add', () => this.generateFavicons())
      .on('change', () => this.generateFavicons())
      .on('unlink', async () => {
        const destination = await this.getDestination()
        await cleanDir(destination)
        return this.plugin.progress(100, 'Cleaned', relativePath(destination), true)
      })

    // Workaround for issue with atomic writes.
    // See https://github.com/paulmillr/chokidar/issues/591
    if (!usePolling) {
      watcher.on('raw', (event, path, { watchedPath }) => {
        if (event === 'rename') {
          watcher.unwatch(src)
          watcher.add(src)
        }
      })
    }

    this.isBeingWatched = true
  }
}

module.exports = RealFaviconGenerator
