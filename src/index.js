'use strict'

const kebabCase = require('lodash.kebabcase')
const deburr = require('lodash.deburr')
const reject = require('lodash.reject')
const path = require('path')

const cleanupFilename = s => kebabCase(deburr(s))

function writeFailedTestInfo ({
  specName,
  title, suiteName, testName,
  testError, testCommands, screenshot}) {
  const info = {
    specName,
    title,
    suiteName,
    testName,
    testError,
    testCommands,
    screenshot
  }
  const str = JSON.stringify(info, null, 2) + '\n'
  const cleaned = cleanupFilename(testName)
  const filename = `failed-${cleaned}.json`
  cy.writeFile(filename, str)
    .log('saved failed test information')

  // work around shell ENOENT failure in CI container
  // const runCmd = `npm run failed-test -- ${filename}`
  // pass filename as environment variable

  // try discovering the shell script filename
  const candidates = [
    './node_modules/cypress-failed-log/on-failed.sh',
    './on-failed.sh'
  ]
  const options = {
    failOnNonZeroExit: false,
    env: {
      FAILED_FILENAME: filename
    }
  }

  function onFailedExec (result) {
    console.log('running cy.exec has failed')
    console.log(result)
    cy.log(JSON.stringify(result))
    cy.writeFile('failed-exec.json', JSON.stringify(result, null, 2))
  }

  cy.exec(candidates[0], options)
    .then(result => {
      if (result.code) {
        onFailedExec(result)
        return cy.exec(candidates[1], options)
      } else {
        console.log('ran npm command successfully', candidates[0])
        return result
      }
    })
    .then(result => {
      if (result.code) {
        onFailedExec(result)
      }
    })
    // .log('ran "npm run failed-test" with the failed test filename', filename)
    .then(result => {
      console.log('exec output')
      console.log(result)
      cy.log(result.stdout)
    })
}

var loggedCommands = []

function startLogging () {
  console.log('Will log Cypress commands')
  Cypress.on('log', function (e) {
    loggedCommands.push(describeCommand(e))
  })
}

function initLog () {
  loggedCommands = []
}

function duplicate (s, k, collection) {
  if (k === 0) {
    return
  }
  return s === collection[k - 1]
}

const describeCommand = c => `${c.name} ${c.message}`.trim()
const notEmpty = c => c

function onFailed () {
  if (this.currentTest.state === 'passed') {
    return
  }
  const testName = this.currentTest.fullTitle()
  // prevents processing failed test twice - from our "afterEach" callback
  // and from wrapping user "afterEach"
  if (hasSeen(testName)) {
    return
  }
  doneWithTest(testName)

  const title = this.currentTest.title
  const screenshotName = `${cleanupFilename(title)}-failed`
  cy.wait(1000)
    .log('waited for UI before capturing screenshot')
  cy.screenshot(screenshotName)
  cy.wait(1000)

  const suiteName = this.currentTest.parent &&
    this.currentTest.parent.title

  const testError = this.currentTest.err.message
  // when running with UI, there are currentTest.commands
  // otherwise just use whatever we have recorded ourselves
  const commands = this.currentTest.commands
    ? this.currentTest.commands.map(describeCommand) : loggedCommands

  // sometimes the message is the same, since the log command events
  // repeat when state changes (command starts, runs, etc)
  // so filter and cleanup
  const testCommands = reject(commands.filter(notEmpty), duplicate)

  const specName = path.basename(window.location.pathname)

  const screenshot = `${screenshotName}.png`

  console.log('=== test failed ===')
  console.log(specName)
  console.log('=== title ===')
  console.log(title)
  if (suiteName) {
    console.log('suite', suiteName)
  }
  console.log(testName)
  console.log('=== error ===')
  console.log(testError)
  console.log('=== commands ===')
  console.log(testCommands.join('\n'))
  console.log('=== screenshot ===')
  console.log(screenshot)
  writeFailedTestInfo({
    specName,
    title,
    suiteName,
    testName,
    testError,
    testCommands,
    screenshot
  })
}

//   We have to do a hack to make sure OUR "afterEach" callback function
// runs BEFORE any user supplied "afterEach" callback. This is necessary
// to take screenshot of the failure AS SOON AS POSSIBLE.
//   Otherwise commands executed by the user callback might destroys the
// screen and add too many commands to the log, making post-mortem
// triage very difficult. In this case we just wrap client supplied
// "afterEach" function with our callback "onFailed". This ensures we run
// first.

// remember which tests we have processed already
const seenTests = {}
function hasSeen (testName) {
  return seenTests[testName]
}
function doneWithTest (testName) {
  seenTests[testName] = true
}

const _afterEach = afterEach
afterEach = (name, fn) => { // eslint-disable-line
  if (typeof name === 'function') {
    fn = name
    name = fn.name
  }
  // before running the client function "fn"
  // run our "onFailed" to capture the screenshot sooner
  _afterEach(name, function () {
    onFailed.call(this)
    fn()
  })
}

startLogging()
beforeEach(initLog)
// register our callback to process failed tests without wrapping
_afterEach(onFailed)
