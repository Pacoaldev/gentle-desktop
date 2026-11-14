// Minimal stand-in for `pi --mode rpc`, used by the folder-change tests: newline-delimited
// JSON on stdio, one reply per command, and a log line for every command that touches the
// session, so a test can tell a fresh session from a re-opened one.
//
// The launch plan resolves its entry from GENTLE_DESKTOP_PI_ENTRY, so this file takes the
// place of pi's bundle without the tests needing a real engine or any credentials.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const logFile = process.env['FAKE_ENGINE_LOG']
function log(line) {
  if (logFile !== undefined && logFile.length > 0) appendFileSync(logFile, `${line}\n`)
}

const cwd = process.cwd()
log(`start ${cwd}`)

// A folder whose name says so is a folder this engine cannot start in, which is what the
// failure path of a folder change has to recover from.
if (cwd.includes('cannot-start')) {
  process.stderr.write('the engine refused to start in this folder\n')
  process.exit(1)
}

// One session file per folder, the way pi names a session after the folder it runs in.
const sessionFile = join(cwd, 'fake-session.json')

function reply(id, command, data) {
  process.stdout.write(`${JSON.stringify({ type: 'response', id, command, success: true, data })}\n`)
}

function handle(command) {
  if (command.type === 'get_state') {
    reply(command.id, 'get_state', { isStreaming: false, sessionFile })
    return
  }
  if (command.type === 'switch_session') {
    log(`switch_session ${command.sessionPath}`)
    reply(command.id, 'switch_session', {})
    return
  }
  if (command.type === 'new_session') {
    log('new_session')
    reply(command.id, 'new_session', {})
    return
  }
  log(`command ${command.type}`)
  reply(command.id, command.type, {})
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line.trim().length > 0) {
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        process.stderr.write(`unparseable command: ${line}\n`)
        parsed = null
      }
      if (parsed !== null) handle(parsed)
    }
    newline = buffer.indexOf('\n')
  }
})

// `transport.close()` ends stdin for an orderly shutdown; a signal is the forced case.
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
