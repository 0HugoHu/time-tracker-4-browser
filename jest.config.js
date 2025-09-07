const { compilerOptions } = require('./tsconfig.json')

const { paths } = compilerOptions

const aliasPattern = /^(@.*)\/\*$/
const sourcePattern = /^(.*)\/\*$/

const moduleNameMapper = {}

Object.entries(paths).forEach(([alias, sourceArr]) => {
    const aliasMatch = alias.match(aliasPattern)
    if (!aliasMatch) {
        return
    }
    if (sourceArr.length !== 1) {
        return
    }
    const sourceMath = sourceArr[0]?.match(sourcePattern)
    if (!sourceMath) {
        return
    }
    const prefix = aliasMatch[1]
    const pattern = `^${prefix}/(.*)$`
    const source = sourceMath[1]
    moduleNameMapper[pattern] = `<rootDir>/${source}/$1`
})

console.log("The moduleNameMapper parsed from tsconfig.json: ")
console.log(moduleNameMapper)

const config = {
    moduleNameMapper,
    roots: [
        "<rootDir>/test",
        "<rootDir>/test-e2e",
    ],
    testRegex: '(.+)\\.test\\.(jsx?|tsx?)$',
    transform: {
        "^.+\\.tsx?$": "@swc/jest"
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
}

module.exports = config