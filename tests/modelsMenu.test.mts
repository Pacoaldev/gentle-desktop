import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentNote, modelOptions, orchestratorNote } from '../src/renderer/src/state/modelsMenu.ts'
import type { ProviderChoice } from '../src/shared/ipc.ts'

function provider(overrides: Partial<ProviderChoice> & Pick<ProviderChoice, 'id'>): ProviderChoice {
  return {
    name: overrides.id,
    supportsOauth: false,
    supportsApiKey: true,
    configured: true,
    ready: true,
    models: [],
    ...overrides
  }
}

test('modelOptions keeps only ready providers that have models', () => {
  const options = modelOptions([
    provider({ id: 'ready', models: [{ provider: 'ready', id: 'big' }] }),
    provider({ id: 'not-ready', ready: false, models: [{ provider: 'not-ready', id: 'ghost' }] }),
    provider({ id: 'empty', models: [] })
  ])

  assert.deepEqual(
    options.map((option) => option.value),
    ['ready/big'],
    'a provider the engine cannot use right now offers nothing, and neither does one without models'
  )
})

test('modelOptions uses the provider/id stored shape and prefers the model name in the label', () => {
  const options = modelOptions([
    provider({ id: 'pi', models: [{ provider: 'pi', id: 'fast' }, { provider: 'pi', id: 'smart', name: 'Smart' }] })
  ])

  assert.deepEqual(options, [
    { value: 'pi/fast', label: 'pi — fast' },
    { value: 'pi/smart', label: 'pi — Smart' }
  ])
})

test('modelOptions dedupes identical provider/id pairs', () => {
  const options = modelOptions([
    provider({ id: 'pi', models: [{ provider: 'pi', id: 'fast' }, { provider: 'pi', id: 'fast', name: 'Fast again' }] })
  ])

  assert.deepEqual(
    options.map((option) => option.value),
    ['pi/fast'],
    'the same pair twice is one pickable model'
  )
})

test('modelOptions sorts by provider, then by label', () => {
  const options = modelOptions([
    provider({ id: 'zeta', models: [{ provider: 'zeta', id: 'b' }, { provider: 'zeta', id: 'a' }] }),
    provider({ id: 'alpha', models: [{ provider: 'alpha', id: 'm' }] })
  ])

  assert.deepEqual(
    options.map((option) => option.value),
    ['alpha/m', 'zeta/a', 'zeta/b']
  )
})

test('the notes are distinct factual sentences', () => {
  const agent = agentNote()
  const orchestrator = orchestratorNote()

  assert.ok(agent.length > 0)
  assert.ok(orchestrator.length > 0)
  assert.notEqual(agent, orchestrator)

  // The facts the window must respect: an agent's model is frozen when a session
  // starts, the orchestrator also switches live in the running session.
  assert.ok(agent.includes('next session'), 'the agent note names the next session')
  assert.ok(orchestrator.includes('live'), 'the orchestrator note names the live change')
  assert.ok(orchestrator.includes('next session'), 'the orchestrator note also names the next session')
})
