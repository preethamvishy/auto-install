'use strict'

const fs = require('fs');
const glob = require('glob');
const isBuiltInModule = require('is-builtin-module');
const syncExec = require("sync-exec");
const ora = require('ora');
const logSymbols = require('log-symbols');
const argv = require('yargs').argv;
const request = require('sync-request');

/* Get installed modules
 * Read dependencies array from package.json
 */

let getInstalledModules = () => {
    let content = JSON.parse(readFile('package.json'));
    let installedModules = [];
    for (let key in content.dependencies) installedModules.push({
        name: key,
        dev: false
    });
    for (let key in content.devDependencies) installedModules.push({
        name: key,
        dev: true
    });
    return installedModules;
};

/* Get used modules
 * Read all .js files and grep for modules
 */

let getUsedModules = () => {
    let files = getFiles();
    let usedModules = [];
    for (let fileName of files) {
        let modulesFromFile = getModulesFromFile(fileName);
        let dev = isTestFile(fileName);
        for (let name of modulesFromFile) usedModules.push({name, dev});
    }
    usedModules = deduplicate(usedModules);
    return usedModules;
};

/* Install module
 * Install given module
 */

let installModule = ({name, dev}) => {
    let spinner = startSpinner('Installing ' + name, 'green');
    if (secureMode && !isModulePopular(name)) {
        stopSpinner(spinner, name + ' not trusted', 'yellow');
        return;
    }

    let command = 'npm install ' + name + ' --save';
    let message = name + ' installed';

    if (dev) command += '-dev';
    if (dev) message += ' in devDependencies';

    let success = runCommand(command);
    if (success) stopSpinner(spinner, message, 'green');
    else stopSpinner(spinner, name + ' installation failed', 'yellow');
};

/* Uninstall module */

let uninstallModule = ({name, dev}) => {
    let spinner = startSpinner('Uninstalling ' + name, 'red');

    let command = 'npm uninstall ' + name + ' --save';
    let message = name + ' removed';

    if (dev) command += '-dev';
    if (dev) message += ' from devDependencies';

    runCommand(command);
    stopSpinner(spinner, message, 'red');
};

/* Command runner
 * Run a given command
 */

let runCommand = (command) => {
    let response = syncExec(command);
    return !response.status; // status = 0 for success
};

/* Show pretty outputs
 * Use ora spinners to show what's going on
 */

let startSpinner = (message, type) => {
    let spinner = ora();
    spinner.text = message;
    spinner.color = type;
    spinner.start();
    return spinner;
};

let stopSpinner = (spinner, message, type) => {
    spinner.stop();
    if (!message) return;
    let symbol;
    if (type === 'red') symbol = logSymbols.error;
    else if (type === 'yellow') symbol = logSymbols.warning;
    else symbol = logSymbols.success;
    console.log(symbol, message);
};

/* Get all js files
 * Return path of all js files
 */
let getFiles = (path) => {
    return glob.sync("**/*.js", {'ignore': ['node_modules/**/*']});
};

/* File reader
 * Return contents of given file
 */
let readFile = (path) => {
    let content = fs.readFileSync(path, 'utf8');
    return content;
};

/* Find modules from file
 * Returns array of modules from a file
 */

let pattern = /require\((.*?)\)/g;

let getModulesFromFile = (path) => {
    let content = fs.readFileSync(path, 'utf8');
    let modules = [];
    let matches = content.match(pattern);
    if (!matches) return modules;
    for(let i = 0; i < matches.length; i++) {
        let match = matches[i];
        match = match.replace('require', '');
        match = match.substring(2)
        match = match.substring(0, match.length - 2);
        if (isValidModule(match)) modules.push(match);
    }
    return modules;
};

/* Check for valid string - to stop malicious intentions */

let isValidModule = ({name, dev}) => {
    let regex = new RegExp("^([a-z0-9-_]{1,})$");
    return regex.test(name);
};

/* Filter registry modules */

let filterRegistryModules = (modules) => {
    modules = removeBuiltInModules(modules);
    modules = removeLocalFiles(modules);
    return modules;
};

/* Remove built in/native modules */

let removeBuiltInModules = (modules) => {
    modules = modules.filter((module) => {
        return !isBuiltInModule(module.name);
    });
    return modules;
};

/* Remove local files that are required */

let removeLocalFiles = (modules) => {
    modules = modules.filter((module) => {
        return (module.name.indexOf('./') !== 0)
    });
    return modules;
};

/* Modules diff */

let diff = (first, second) => {
    let namesFromSecond = getNamesFromModules(second);
    return first.filter(module => namesFromSecond.indexOf(module.name) < 0);
};

/* Reinstall modules */

let reinstall = () => {
    let spinner = startSpinner('Cleaning up', 'green');
    runCommand('npm install');
    stopSpinner(spinner);
};

/* Secure mode */

let secureMode = false;
if (argv.secure) secureMode = true;

/* Is module popular? - for secure mode */

const POPULARITY_THRESHOLD = 10000;
let isModulePopular = ({name, dev}) => {
    let url = 'https://apa.npmjs.org/downloads/point/last-month/' + name;
    request('GET', url, (error, response, body) => {
        let downloads = JSON.parse(body).downloads;
        return (downloads > POPULARITY_THRESHOLD);
    });
};

/* Is test file? */

let isTestFile = (name) => {
    return (name.endsWith('.spec.js') || name.endsWith('.test.js'));
};

/* Get module names from array of module objects */

let getNamesFromModules = (modules) => {
    return modules.map(module => module.name);
};

/* Dedup modules
 * Divide modules into prod and dev
 * Deduplicates each list
 */

let deduplicate = (modules) => {
    let dedupedModules = [];

    let testModules = modules.filter(module => module.dev);
    dedupedModules = dedupedModules.concat(deduplicateSimilarModules(testModules));

    let prodModules = modules.filter(module => !module.dev);
    dedupedModules = dedupedModules.concat(deduplicateSimilarModules(prodModules));

    return dedupedModules;
};

/* Dedup similar modules
 * Deduplicates list
 * Ignores/assumes type of the modules in list
*/

let deduplicateSimilarModules = (modules) => {
    let dedupedModules = [];
    let dedupedModuleNames = [];

    for (let module of modules) {
        if (dedupedModuleNames.indexOf(module.name) === -1) {
            dedupedModules.push(module);
            dedupedModuleNames.push(module.name);
        }
    }

    return dedupedModules;
};

/* Public helper functions */

module.exports = {
    getInstalledModules,
    getUsedModules,
    filterRegistryModules,
    installModule,
    uninstallModule,
    diff,
    reinstall
};

