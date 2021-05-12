// Node.js
const path = require('path')

// Modules.
const chokidar = require('chokidar')
const chalk = require('chalk')
const BuildOutputPlugin = require('laravel-mix/src/webpackPlugins/BuildOutputPlugin')
const Log = require('laravel-mix/src/Log')
const terminalLink = require('terminal-link')
const termImg = require('term-img')
const webpack = require('webpack')
const WebpackBar = require('webpackbar')

// Local.
const RealFaviconGenerator = require('./RealFaviconGenerator')
const { cleanDir, relativePath, pathExists } = require('./util')

const { Mix } = global
const privates = new WeakMap()

class LaravelMixRfgPlugin {
  constructor() {

    privates.set(this, {
      compiler: undefined,
      hooked: false,
      registered: false,
      watch: Mix.isWatching(),
      webpackBar: undefined,
    })
    this.options = {}
    this.rfg = new RealFaviconGenerator(this)
  }

  get compiler() {
    const _ = privates.get(this)
    if (!_.compiler) {
      const MockEntryPlugin = require('laravel-mix/src/webpackPlugins/MockEntryPlugin')
      const Entry = require('laravel-mix/src/builder/Entry')
      const entry = new Entry(Mix)
      entry.addDefault()
      _.compiler = webpack({
        mode: Mix.inProduction() ? 'production' : 'development',
        entry: entry.get(),
        output: {
          path: path.resolve(Mix.config.publicPath),
          filename: '[name].js',
          publicPath: '/',
        },
        plugins: [
          new MockEntryPlugin(Mix),
          this.webpackBar,
        ]
      })
    }
    return _.compiler
  }

  get webpackBar() {
    const _ = privates.get(this)
    if (!_.webpackBar) {
      _.webpackBar = new WebpackBar({
        name: `[${this.name(true)}]`,
        reporter: {
          afterAllDone: async () => this.printResult()
        }
      })
    }
    return _.webpackBar
  }

  apply(compiler) {
    const _ = privates.get(this)

    if (_.hooked || !_.registered) {
      return
    }

    this.compiler.context = compiler.context
    this.compiler.inputFileSystem = compiler.inputFileSystem
    this.compiler.outputFileSystem = compiler.outputFileSystem

    this.rfg.setOptions(this.options)

    compiler.hooks.done.tapPromise(this.constructor.name, async (compilation) => {
      // Wait for the child compiler to finish.
      this.compiler.hooks.make.tapPromise(this.constructor.name, async () => {
        // const fileDependencies = await this.getFileDependencies()
        //
        // fileDependencies.forEach((fileDependency) =>
        // compilation.fileDependencies.add(fileDependency))

        const run = async () => {
          try {
            this.webpackBar.state.color = 'green'
            this.webpackBar.state.hasErrors = false

            await this.rfg.generateFavicons()

            await this.printResult()
          }
          catch (error) {
            this.webpackBar.state.color = 'red'
            this.webpackBar.state.hasErrors = true
            let message = chalk.red(error.message)
            if (this.options.debug && error.stack) {
              message += error.stack.replace(new RegExp(`^.*${error.message}`, 'i'), '')
            }
            await this.progress(-1, message)
          }
        }

        if (Mix.isWatching()) {
          const src = await this.rfg.getSourceFile()
          if (!src) {
            return
          }

          const destination = await this.rfg.getDestination()
          const usePolling = Mix.isPolling()

          const watcher = chokidar
            .watch(src, {
              ignoreInitial: await pathExists(destination),
              persistent: true,
              ...(this.options.watch || {}),
              usePolling,
            })
            .on('add', async () => run())
            .on('change', async () => run())
            .on('unlink', async () => {
              await cleanDir(destination)
              await this.progress(100, 'Cleaned', relativePath(destination), true)
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
        }
        else {
          await run()
        }
      })

      // Run the RFG webpack compiler.
      await new Promise((resolve) => {
        this.compiler.run(async (err, stats) => {
          // const errors = [].concat(err).filter(Boolean)
          // if (stats && stats.hasErrors()) {
          //   errors.push(...stats.compilation.errors)
          // }
          //
          // errors.forEach((error) => {
          //   this.rfg.log('error', error.stack || error.message)
          // })

          this.compiler.close(resolve)
        })
      })
    })

    // // For the assets to actually show up though, this hook must be moved
    // // before laravel-mix's BuildOutputPlugin.
    // const { taps } = mixCompiler.hooks.done
    //
    // const BuildOutputPluginIndex = taps.indexOf(taps.filter((o) => o.name
    // === 'BuildOutputPlugin') .shift())  // Pop off the last tap as it's this
    // plugin's (was just added above). const last = taps.pop()
    // taps.splice(BuildOutputPluginIndex < 0 ? 0 : BuildOutputPluginIndex, 0,
    // last)  mixCompiler.hooks.done.hooks

    _.hooked = true
  }

  debug(message, error) {
    if (!this.options.debug) {
      return
    }
    this.log('debug', message, error)
  }

  async getFileDependencies() {
    return new Set([
      ...(await this.rfg.getConfigFiles()).keys(),
      await this.rfg.getSourceFile(),
    ])
  }

  log(type, message, error) {
    let text = `[${this.name(true)}] `

    if (message instanceof Error) {
      error = message
      message = ''
    }
    else if (Array.isArray(message)) {
      message = message.join('\n')
    }

    text += message

    if (error instanceof Error) {
      if (message) {
        text += '\n\n'
      }
      text += error.stack || error.message
    }

    if (type === 'error' || type === 'fatal') {
      type = 'error'
    }
    else if (type === 'warn' || type === 'warning') {
      type = 'warn'
    }
    else if (type === 'debug') {
      if (!this.options.debug) {
        return
      }
      type = 'info'
    }
    else {
      Log.line(text)
    }
    Log.message({ type, text })
  }

  name(long = false) {
    if (long) {
      return 'laravel-mix-rfg'
    }
    return 'rfg'
  }

  async printResult() {
    if (!this.rfg.json) {
      return
    }

    const destination = await this.rfg.getDestination()
    const previewBaseName = path.basename(this.rfg.json.preview_picture_url)
    const previewFile = path.join(destination, previewBaseName)

    const messages = [
      ['Destination', terminalLink(relativePath(destination), `file://${destination}`, {
        fallback: () => relativePath(destination)
      })],
      ['Preview', terminalLink(relativePath(previewFile), `file://${previewFile}`, {
        fallback: () => relativePath(previewFile)
      })],
    ]

    let previewImage = await termImg(previewFile, {
      height: 'auto',
      width: 'auto',
      fallback: () => '',
    })
    if (previewImage) {
      messages.push([null, `\n\t\t${previewImage}`])
    }

    let message = [
      chalk.green.bold('Generated Favicons'),
      '',
      ...messages.map(([label, value]) => {
        if (!label) {
          label = '\t\t'
        }
        else {
          label = chalk.white.bold(`${label}:\t`)
        }
        return `${label}${value}`
      })
    ].join('\n  ')

    if (this.rfg.assets.length) {
      const assets = this.rfg.assets.map((file) => {
        const absolute = file.path()
        const relative = relativePath(absolute)
        return {
          name: terminalLink(relative, `file://${absolute}`, {
            fallback: () => relative
          }),
          size: file.size(),
        }
      })

      if (assets.length) {
        // To account for table being displayed in webpackBar, shave
        // off 2 columns.
        let columns = process.stdout.columns
        if (columns) {
          process.stdout.columns = columns - 2
        }
        message += `\n${new BuildOutputPlugin().statsTable({ assets })}`
        process.stdout.columns = columns
      }
    }

    await this.progress(100, message, true)
  }

  async progress(percent, message, details, force = false) {
    // Allow force to be passed instead of details.
    if (details === true) {
      force = true
      details = undefined
    }

    return new Promise((resolve) => {
      this.percent = Math.floor(percent)
      details = [].concat(details).filter(Boolean)

      const apply = () => {
        this.webpackBar.updateProgress(this.percent / 100, message, [...details])

        let inlineMessage = `${message}`
        if (details.length) {
          inlineMessage += ` (${details.join(' ')})`
        }
        this.debug(`${this.percent}% ${inlineMessage}`)
        resolve()
      }

      // The WebpackBar FancyReporter only renders every 50ms, if the progress
      // message is forced, it needs to be wrapped in a setTimeout greater
      // than 50ms for it to ensure its printed.
      // @todo Replace with better implementation if/when stream write
      //    callbacks are ever supported in WebpackBar.
      if (force) {
        setTimeout(apply, 51)
      }
      else {
        apply()
      }
    })
  }

  register(options = {}) {
    privates.get(this).registered = true
    this.options = {
      ...(options || {}),
    }
  }

  webpackPlugins() {
    return [this]
  }
}

module.exports = LaravelMixRfgPlugin
