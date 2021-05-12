const { Mix } = global

const LaravelMixRfgPlugin = require('./src/LaravelMixRfgPlugin')

// Note: do not use mix.extend() as it overrides the plugin's name() method.
Mix.registrar.install(new LaravelMixRfgPlugin());
