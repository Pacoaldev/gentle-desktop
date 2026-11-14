import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveGentleDestinations } from '../src/renderer/src/state/gentleMenu.ts'

const profileCommand = { name: 'gentle:profiles', description: 'Choose an agent model profile' }
const modeCommand = { name: 'gentle:permission', description: 'Set the permission mode' }

const ALL_IDS = ['profiles', 'mode', 'folder', 'subagents', 'providers', 'commands']

test('profiles is always present, as the app\'s own Models surface', () => {
  const withCommands = resolveGentleDestinations([profileCommand, modeCommand])
  assert.deepEqual(
    withCommands.map((destination) => destination.id),
    ALL_IDS
  )
  assert.equal(withCommands[0]?.label, 'Models')
  assert.equal(withCommands[0]?.detail, 'Choose the model each agent and the orchestrator use')
  assert.equal(
    withCommands[0]?.command,
    null,
    'the Models row opens the app\'s own window over the engine\'s store, it does not start a turn'
  )
  assert.equal(
    withCommands[1]?.command,
    null,
    'the mode row opens a read-only window, it does not start a turn'
  )

  const withoutCommands = resolveGentleDestinations([])
  assert.deepEqual(
    withoutCommands.map((destination) => destination.id),
    ALL_IDS,
    'the Models window reads the store over IPC, so it does not need the engine\'s command list'
  )
})

test('a destination is matched by command name, never by description', () => {
  const tempting = { name: 'gentle:review', description: 'Review the profile of the change' }
  const ids = resolveGentleDestinations([tempting]).map((destination) => destination.id)

  assert.deepEqual(
    ids,
    ALL_IDS,
    'a description is not an identity, and no destination is routed to an engine command anymore'
  )
})

test('the app surfaces are always present, in a fixed order', () => {
  const destinations = resolveGentleDestinations([profileCommand, modeCommand])
  const tail = destinations.slice(-3).map((destination) => destination.id)

  assert.deepEqual(tail, ['subagents', 'providers', 'commands'])
  assert.deepEqual(
    destinations.map((destination) => destination.command),
    [null, null, null, null, null, null],
    'every row opens an app window, none starts a turn'
  )
})

test('every destination carries a label and a one-line detail', () => {
  for (const destination of resolveGentleDestinations([profileCommand, modeCommand])) {
    assert.ok(destination.label.length > 0)
    assert.ok(destination.detail.length > 0)
  }
})
