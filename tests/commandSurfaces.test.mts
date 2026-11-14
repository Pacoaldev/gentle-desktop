import assert from 'node:assert/strict'
import { test } from 'node:test'
import { opensModelsWindow, opensPermissionsWindow } from '../src/renderer/src/state/commandSurfaces.ts'

test('only the engine mode commands open the Permissions window', () => {
  // These are the only commands whose RPC answer is the mode it already reports; every
  // other command keeps the ordinary prompt path.
  for (const command of ['/gentle:mode', 'gentle:yolo', 'gentle:mode status', 'gentle:mode default yolo']) {
    assert.equal(opensPermissionsWindow(command), true, `${command} opens the window`)
  }

  for (const command of [
    '/gentle:profiles',
    '/gentle:modex',
    '/history',
    '/gentle:review-mode',
    '/gentle:permission',
    '/gentle:agents'
  ]) {
    assert.equal(opensPermissionsWindow(command), false, `${command} stays on the prompt path`)
  }
})

test('only a bare profiles command opens the Models window', () => {
  // `gentle:profiles export|publish|import|restore-routing|clear` are real engine
  // subcommands that must keep the prompt path; only the bare command is the app's
  // own surface. A trailing space is still bare.
  for (const command of ['/gentle:profiles', 'gentle:profiles', '/gentle:profiles ']) {
    assert.equal(opensModelsWindow(command), true, `${command} opens the window`)
  }

  for (const command of [
    '/gentle:profiles export base',
    '/gentle:profiles import',
    '/gentle:profiles restore-routing',
    '/gentle:mode',
    '/history',
    '/gentle:settings'
  ]) {
    assert.equal(opensModelsWindow(command), false, `${command} stays on the prompt path`)
  }
})
