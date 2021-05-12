const { mkdir, rm, stat } = require('fs/promises')
const path = require('path')

const calculatePercentage = (total, current, start = 0) => start + ((9 / total) * (current + 1))

const cleanDir = async (dir, recursive = true) => {
  if (!await pathExists(dir)) {
    await mkdir(dir, { recursive })
    return
  }
  return rm(dir, { force: true, recursive })
}

const maskString = (string, mask = '*') => {
  string = `${string}`
  const max = Math.ceil(string.length * .10)
  return string.substr(0, max) + string.substr(max, string.length - (max * 2)).replace(/./g, mask) + string.substr(-max)
}

const pathExists = async path => !!(await stat(path).catch(() => false))

const relativePath = (to) => to && `./${path.relative(process.cwd(), to)}`

const replaceAsync = (string, searchValue, replacer) => {
  try {
    if (typeof replacer !== 'function') {
      return Promise.resolve(String.prototype.replace.call(string, searchValue, replacer))
    }
    const values = []
    String.prototype.replace.call(string, searchValue, (...args) => values.push(replacer.apply(undefined, args)) || '')
    return Promise.all(values)
      .then((resolvedValues) => String.prototype.replace.call(string, searchValue, () => resolvedValues.shift()))
  }
  catch (error) {
    return Promise.reject(error)
  }
}

module.exports = {
  cleanDir,
  calculatePercentage,
  maskString,
  pathExists,
  relativePath,
  replaceAsync,
}
