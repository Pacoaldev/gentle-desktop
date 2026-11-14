import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PERMISSION_MODES, defaultModeCommand } from '../src/renderer/src/state/permissionModes.ts'

test('the modes are exactly the engine\'s four, in its menu order, with no duplicates', () => {
  assert.deepEqual(
    PERMISSION_MODES.map((choice) => choice.mode),
    ['normal', 'auto', 'yolo', 'super-yolo']
  )
  assert.equal(new Set(PERMISSION_MODES.map((choice) => choice.mode)).size, PERMISSION_MODES.length)
})

test('every row carries a nonempty label and detail, and the details differ', () => {
  for (const choice of PERMISSION_MODES) {
    assert.ok(choice.label.length > 0)
    assert.ok(choice.detail.length > 0)
  }
  assert.equal(new Set(PERMISSION_MODES.map((choice) => choice.detail)).size, PERMISSION_MODES.length)
})

test('the details are gentle-pi\'s menu strings, frozen literally', () => {
  // menu strings from gentle-pi lib/yolo-session-policy.ts MODE_CHOICES (S20):
  // a mode's meaning is its own words, never invented here.
  assert.deepEqual(
    PERMISSION_MODES.map((choice) => choice.detail),
    [
      'standard permission prompts',
      'independent checks; extra model calls',
      'scoped work; destructive actions ask',
      'no permission prompts; private paths blocked; consent remains'
    ]
  )
})

test('the command that changes the saved default is named exactly', () => {
  assert.equal(defaultModeCommand('super-yolo'), '/gentle:mode default super-yolo')
  assert.equal(defaultModeCommand('normal'), '/gentle:mode default normal')
})
