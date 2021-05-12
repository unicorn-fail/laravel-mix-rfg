const mix = require('laravel-mix')

require('./index')

mix.options({
  clearConsole: false,
})

mix.setPublicPath('dist')

mix.rfg({
  // cache: false,
  // debug: true,
  config: {
    design: {
      desktopBrowser: {},
    }
  }
})
