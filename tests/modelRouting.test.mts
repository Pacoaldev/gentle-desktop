import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  applyOrchestratorDefault,
  readRouting,
  setActiveProfile,
  setAgentModel,
  setOrchestratorModel
} from '../src/main/model-routing.ts'

const created: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-routing-'))
  created.push(home)
  return home
}

afterEach(() => {
  for (const home of created) rmSync(home, { recursive: true, force: true })
  created.length = 0
})

/**
 * The shapes the real store on this machine carries: an overrides pseudo-profile named
 * `current`, a single-role profile, and a multi-agent profile with thinking levels.
 */
const MULTI_AGENT = JSON.stringify({
  kind: 'gentle-pi.agent_model_profiles',
  version: 1,
  active: 'base',
  workflow: { base: { orchestratorMode: 'organic' } },
  futureField: { note: 'written by something else, must survive' },
  profiles: {
    current: {},
    base: { orchestrator: { model: 'opencode-go/deepseek-v4-flash' } },
    nan_builders: {
      orchestrator: { model: 'nan/deepseek-v4-flash', thinking: 'high' },
      'gentle-ai-explore': { model: 'nan/glm5.3-flash', thinking: 'low', tier: 'fast' },
      nan_implementer: { model: 'nan/kimi-k2' }
    }
  }
})

function homeWithStore(contents: string): string {
  const home = tempHome()
  writeFileSync(join(home, 'profiles.json'), contents, 'utf8')
  return home
}

function profilesOf(home: string): Record<string, unknown> {
  return (
    JSON.parse(readFileSync(join(home, 'profiles.json'), 'utf8')) as {
      profiles: Record<string, unknown>
    }
  ).profiles
}

test('readRouting names the store, marks the active profile and expands every role', () => {
  const home = homeWithStore(MULTI_AGENT)

  const view = readRouting(home)

  assert.equal(view.configHome, home)
  assert.equal(view.fileStatus, 'valid')
  assert.equal(view.active, 'base')
  assert.deepEqual(
    view.profiles.map((profile) => profile.name),
    ['base', 'nan_builders'],
    'current is an overrides holder, not a profile, so it is excluded'
  )

  const base = view.profiles[0]
  assert.ok(base)
  assert.equal(base.active, true)
  assert.deepEqual(base.orchestrator, {
    name: 'orchestrator',
    model: 'opencode-go/deepseek-v4-flash',
    thinking: null
  })
  assert.deepEqual(base.agents, [])

  const nan = view.profiles[1]
  assert.ok(nan)
  assert.equal(nan.active, false)
  assert.deepEqual(nan.orchestrator, {
    name: 'orchestrator',
    model: 'nan/deepseek-v4-flash',
    thinking: 'high'
  })
  assert.deepEqual(
    nan.agents.map((agent) => [agent.name, agent.model, agent.thinking]),
    [
      ['gentle-ai-explore', 'nan/glm5.3-flash', 'low'],
      ['nan_implementer', 'nan/kimi-k2', null]
    ],
    'agents are sorted by name and thinking is carried next to the model'
  )
})

test('a role with no model reads as inherit: null, never a guess', () => {
  const home = homeWithStore(
    JSON.stringify({
      kind: 'gentle-pi.agent_model_profiles',
      version: 1,
      profiles: { base: { reviewer: { thinking: 'low' } } }
    })
  )

  const view = readRouting(home)
  assert.deepEqual(view.profiles[0]?.agents, [
    { name: 'reviewer', model: null, thinking: 'low' }
  ])
})

test('a missing store reads as missing with no profiles', () => {
  const view = readRouting(tempHome())

  assert.equal(view.fileStatus, 'missing')
  assert.equal(view.active, null)
  assert.deepEqual(view.profiles, [])
})

test('a malformed or wrong-kind store reads as invalid and lists nothing', () => {
  for (const contents of ['not json', '[]', '{"kind":"something-else","version":1,"profiles":{}}']) {
    const view = readRouting(homeWithStore(contents))
    assert.equal(view.fileStatus, 'invalid', contents)
    assert.deepEqual(view.profiles, [])
  }
})

test('a store whose profiles value is not an object is invalid', () => {
  const view = readRouting(
    homeWithStore(JSON.stringify({ kind: 'gentle-pi.agent_model_profiles', version: 1, profiles: 7 }))
  )
  assert.equal(view.fileStatus, 'invalid')
})

test('setting an agent model adds the role while every other profile, workflow, current and unknown keys survive', () => {
  const home = homeWithStore(MULTI_AGENT)

  const result = setAgentModel(home, 'base', 'nan_implementer', 'nan/glm5.3-flash')
  assert.deepEqual(result, { ok: true })

  const raw = readFileSync(join(home, 'profiles.json'), 'utf8')
  const doc = JSON.parse(raw) as Record<string, unknown>
  assert.deepEqual(doc['futureField'], { note: 'written by something else, must survive' })
  assert.deepEqual(doc['workflow'], { base: { orchestratorMode: 'organic' } })
  assert.deepEqual(doc['active'], 'base')
  const profiles = doc['profiles'] as Record<string, unknown>
  assert.deepEqual(profiles['current'], {}, 'current survives untouched')
  assert.deepEqual(profiles['nan_builders'], {
    orchestrator: { model: 'nan/deepseek-v4-flash', thinking: 'high' },
    'gentle-ai-explore': { model: 'nan/glm5.3-flash', thinking: 'low', tier: 'fast' },
    nan_implementer: { model: 'nan/kimi-k2' }
  })
  assert.deepEqual(profiles['base'], {
    orchestrator: { model: 'opencode-go/deepseek-v4-flash' },
    nan_implementer: { model: 'nan/glm5.3-flash' }
  })
})

test('clearing an agent model removes the role only when nothing else is in it', () => {
  const home = homeWithStore(MULTI_AGENT)

  assert.deepEqual(setAgentModel(home, 'nan_builders', 'nan_implementer', null), { ok: true })
  let profiles = profilesOf(home) as Record<string, Record<string, unknown>>
  assert.equal('nan_implementer' in profiles['nan_builders'], false, 'an empty role object is removed')

  assert.deepEqual(setAgentModel(home, 'nan_builders', 'gentle-ai-explore', null), { ok: true })
  profiles = profilesOf(home) as Record<string, Record<string, unknown>>
  assert.deepEqual(
    profiles['nan_builders']['gentle-ai-explore'],
    { thinking: 'low', tier: 'fast' },
    'a role that still carries thinking or a tier stays, without its model'
  )
})

test('a role that carries only thinking is created when clearing leaves it meaningful', () => {
  const home = homeWithStore(MULTI_AGENT)
  setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2')

  assert.deepEqual(setAgentModel(home, 'base', 'reviewer', null), { ok: true })
  const profiles = profilesOf(home) as Record<string, Record<string, unknown>>
  assert.equal('reviewer' in profiles['base'], false)
})

test('a model reference must be a provider/id pair, or the write is refused untouched', () => {
  const home = homeWithStore(MULTI_AGENT)
  const before = readFileSync(join(home, 'profiles.json'), 'utf8')

  for (const model of ['justname', '/missing-provider', 'missing-id/', 'two words/x', '']) {
    const result = setAgentModel(home, 'base', 'reviewer', model)
    assert.equal(result.ok, false, model)
    assert.match((result as { error: string }).error, /provider/)
  }

  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), before)
})

test('unknown profiles and the current overrides holder are refused as write targets', () => {
  const home = homeWithStore(MULTI_AGENT)
  const before = readFileSync(join(home, 'profiles.json'), 'utf8')

  const missing = setAgentModel(home, 'no_such_profile', 'reviewer', 'nan/kimi-k2')
  assert.equal(missing.ok, false)
  const overrides = setAgentModel(home, 'current', 'reviewer', 'nan/kimi-k2')
  assert.equal(overrides.ok, false)

  assert.equal(setOrchestratorModel(home, 'no_such_profile', 'nan/kimi-k2').ok, false)
  assert.equal(setOrchestratorModel(home, 'current', 'nan/kimi-k2').ok, false)
  assert.equal(setActiveProfile(home, 'no_such_profile').ok, false)
  assert.equal(setActiveProfile(home, 'current').ok, false)

  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), before)
})

test('setting the orchestrator model keeps its thinking and tier neighbours intact', () => {
  const home = homeWithStore(MULTI_AGENT)

  const result = setOrchestratorModel(home, 'nan_builders', 'opencode-go/kimi-k2.5')
  assert.deepEqual(result, { ok: true, profileActive: false })

  const profiles = profilesOf(home) as Record<string, Record<string, unknown>>
  assert.deepEqual(profiles['nan_builders']['orchestrator'], {
    model: 'opencode-go/kimi-k2.5',
    thinking: 'high'
  })
})

test('a profile without an orchestrator entry gains one on write', () => {
  const home = homeWithStore(MULTI_AGENT)

  assert.deepEqual(setOrchestratorModel(home, 'base', 'nan/glm5.3-flash'), {
    ok: true,
    profileActive: true
  })

  const view = readRouting(home)
  assert.deepEqual(view.profiles[0]?.orchestrator, {
    name: 'orchestrator',
    model: 'nan/glm5.3-flash',
    thinking: null
  })
})

test('setActiveProfile writes the top-level active marker', () => {
  const home = homeWithStore(MULTI_AGENT)

  assert.deepEqual(setActiveProfile(home, 'nan_builders'), { ok: true })

  const doc = JSON.parse(readFileSync(join(home, 'profiles.json'), 'utf8')) as Record<string, unknown>
  assert.equal(doc['active'], 'nan_builders')
})

test('a missing store refuses every write', () => {
  const home = tempHome()

  const result = setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2')
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /missing/)
})

test('a malformed store is reported and left byte-identical, never rewritten', () => {
  const contents = '{ "kind": "gentle-pi.agent_model_profiles", "version": 1, "profiles": {'
  const home = homeWithStore(contents)

  for (const attempt of [
    () => setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2'),
    () => setOrchestratorModel(home, 'base', 'nan/kimi-k2'),
    () => setActiveProfile(home, 'base')
  ]) {
    const result = attempt()
    assert.equal(result.ok, false)
    assert.match((result as { error: string }).error, /cannot be read|not valid/)
  }

  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), contents)
  assert.deepEqual(readdirSync(home).filter((name) => name.endsWith('.tmp')), [], 'no temp file is left behind')
})

test('no temp files are left behind by a successful write either', () => {
  const home = homeWithStore(MULTI_AGENT)

  assert.deepEqual(setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2'), { ok: true })
  assert.deepEqual(
    readdirSync(home).filter((name) => name.endsWith('.tmp')),
    []
  )
})

test('applyOrchestratorDefault splits the pair, preserves every other key and the thinking level', () => {
  const home = tempHome()
  const settings = join(home, 'settings.json')
  writeFileSync(
    settings,
    JSON.stringify(
      {
        theme: 'dark',
        packages: ['gentle-pi'],
        defaultProvider: 'opencode-go',
        defaultModel: 'deepseek-v4-flash',
        defaultThinkingLevel: 'high'
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  const result = applyOrchestratorDefault(home, 'nan/glm5.3-flash')
  assert.deepEqual(result, { ok: true })

  const doc = JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>
  assert.deepEqual(doc, {
    theme: 'dark',
    packages: ['gentle-pi'],
    defaultProvider: 'nan',
    defaultModel: 'glm5.3-flash',
    defaultThinkingLevel: 'high'
  })
})

test('applyOrchestratorDefault creates a settings file that does not exist yet', () => {
  const home = tempHome()

  assert.deepEqual(applyOrchestratorDefault(home, 'nan/glm5.3-flash'), { ok: true })
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')), {
    defaultProvider: 'nan',
    defaultModel: 'glm5.3-flash'
  })
})

test('applyOrchestratorDefault refuses a settings file it cannot parse as an object', () => {
  const home = tempHome()
  const settings = join(home, 'settings.json')

  writeFileSync(settings, 'not json', 'utf8')
  const malformed = applyOrchestratorDefault(home, 'nan/glm5.3-flash')
  assert.equal(malformed.ok, false)
  assert.equal(readFileSync(settings, 'utf8'), 'not json')

  writeFileSync(settings, '[]', 'utf8')
  assert.equal(applyOrchestratorDefault(home, 'nan/glm5.3-flash').ok, false)
})

test('applyOrchestratorDefault refuses a model reference without a provider half', () => {
  const home = tempHome()
  const settings = join(home, 'settings.json')
  writeFileSync(settings, '{"theme":"dark"}', 'utf8')

  const result = applyOrchestratorDefault(home, 'justname')
  assert.equal(result.ok, false)
  assert.equal(readFileSync(settings, 'utf8'), '{"theme":"dark"}')
})

test('applyOrchestratorDefault skips the write when the text would be identical', () => {
  const home = tempHome()
  const settings = join(home, 'settings.json')
  const text = `${JSON.stringify({ defaultProvider: 'nan', defaultModel: 'glm5.3-flash' }, null, 2)}\n`
  writeFileSync(settings, text, 'utf8')

  const before = readFileSync(settings, 'utf8')
  assert.deepEqual(applyOrchestratorDefault(home, 'nan/glm5.3-flash'), { ok: true })
  assert.equal(readFileSync(settings, 'utf8'), before)
  assert.deepEqual(readdirSync(home).filter((name) => name.endsWith('.tmp')), [])
})

// ---- B1: the store write knows whether the edited profile is the active one ----

test('setOrchestratorModel reports whether the edited profile is the active one', () => {
  const home = homeWithStore(MULTI_AGENT) // active: 'base'

  assert.deepEqual(setOrchestratorModel(home, 'nan_builders', 'opencode-go/kimi-k2.5'), {
    ok: true,
    profileActive: false
  })
  assert.deepEqual(setOrchestratorModel(home, 'base', 'nan/glm5.3-flash'), {
    ok: true,
    profileActive: true
  })
})

// ---- S1: string-form role entries ----

test('a role written as a bare string reads as its model, never as inherit', () => {
  const home = homeWithStore(
    JSON.stringify({
      kind: 'gentle-pi.agent_model_profiles',
      version: 1,
      profiles: { base: { reviewer: 'nan/kimi-k2' } }
    })
  )

  const view = readRouting(home)
  assert.deepEqual(view.profiles[0]?.agents, [{ name: 'reviewer', model: 'nan/kimi-k2', thinking: null }])
})

test('writing over a string-form role converts it to the object form and preserves the rest of the file', () => {
  const home = homeWithStore(
    JSON.stringify({
      kind: 'gentle-pi.agent_model_profiles',
      version: 1,
      active: 'base',
      workflow: { base: { orchestratorMode: 'organic' } },
      profiles: { base: { reviewer: 'nan/kimi-k2', other: { model: 'nan/glm5.3-flash', thinking: 'low' } } }
    })
  )

  assert.deepEqual(setAgentModel(home, 'base', 'reviewer', 'nan/glm5.3-flash'), { ok: true })

  const doc = JSON.parse(readFileSync(join(home, 'profiles.json'), 'utf8')) as Record<string, unknown>
  assert.deepEqual(doc['workflow'], { base: { orchestratorMode: 'organic' } })
  const profiles = doc['profiles'] as Record<string, unknown>
  assert.deepEqual(profiles['base'], {
    reviewer: { model: 'nan/glm5.3-flash' },
    other: { model: 'nan/glm5.3-flash', thinking: 'low' }
  })
})

// ---- S2: the untested refusal paths ----

test('a store with a wrong kind or wrong version is refused on write and left byte-identical', () => {
  for (const contents of [
    JSON.stringify({ kind: 'something-else', version: 1, profiles: {} }),
    JSON.stringify({ kind: 'gentle-pi.agent_model_profiles', version: 2, profiles: {} })
  ]) {
    const home = homeWithStore(contents)

    for (const attempt of [
      () => setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2'),
      () => setOrchestratorModel(home, 'base', 'nan/kimi-k2'),
      () => setActiveProfile(home, 'base')
    ]) {
      const result = attempt()
      assert.equal(result.ok, false, contents)
      assert.match((result as { error: string }).error, /kind or version/)
    }

    assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), contents)
    assert.deepEqual(readdirSync(home).filter((name) => name.endsWith('.tmp')), [])
  }
})

test('a missing store refuses the orchestrator and active-profile writes too', () => {
  const home = tempHome()

  const orchestrator = setOrchestratorModel(home, 'base', 'nan/kimi-k2')
  assert.equal(orchestrator.ok, false)
  assert.match((orchestrator as { error: string }).error, /missing/)

  const active = setActiveProfile(home, 'base')
  assert.equal(active.ok, false)
  assert.match((active as { error: string }).error, /missing/)
})

test('an identical write to profiles.json changes nothing on disk and leaves no temp file', () => {
  const home = homeWithStore(MULTI_AGENT)

  // The first write lands (re-serializing in the engine format); the second is identical.
  assert.deepEqual(setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2'), { ok: true })
  const afterFirst = readFileSync(join(home, 'profiles.json'), 'utf8')

  assert.deepEqual(setAgentModel(home, 'base', 'reviewer', 'nan/kimi-k2'), { ok: true })
  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), afterFirst)
  assert.deepEqual(readdirSync(home).filter((name) => name.endsWith('.tmp')), [])
})

test('the reserved orchestrator name and an empty agent name are refused untouched', () => {
  const home = homeWithStore(MULTI_AGENT)
  const before = readFileSync(join(home, 'profiles.json'), 'utf8')

  const reserved = setAgentModel(home, 'base', 'orchestrator', 'nan/kimi-k2')
  assert.equal(reserved.ok, false)
  assert.match((reserved as { error: string }).error, /reserved/)

  const empty = setAgentModel(home, 'base', '', 'nan/kimi-k2')
  assert.equal(empty.ok, false)
  assert.match((empty as { error: string }).error, /name the agent/)

  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), before)
})

test('applyOrchestratorDefault splits a provider/id whose id carries a slash', () => {
  const home = tempHome()

  assert.deepEqual(applyOrchestratorDefault(home, 'a/b/c'), { ok: true })
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')), {
    defaultProvider: 'a',
    defaultModel: 'b/c'
  })
})

// ---- Cheap nits ----

test('an agent name the engine would reject is refused, prototype keys included', () => {
  const home = homeWithStore(MULTI_AGENT)
  const before = readFileSync(join(home, 'profiles.json'), 'utf8')

  for (const agent of ['bad name', '__proto__', 'x;drop']) {
    const result = setAgentModel(home, 'base', agent, 'nan/kimi-k2')
    assert.equal(result.ok, false, agent)
    assert.match((result as { error: string }).error, /agent name/)
  }

  assert.equal(readFileSync(join(home, 'profiles.json'), 'utf8'), before)
})

test('a model id is trimmed before it is validated and stored', () => {
  const home = homeWithStore(MULTI_AGENT)

  const result = setAgentModel(home, 'base', 'reviewer', '  nan/kimi-k2  ')
  assert.deepEqual(result, { ok: true })
  const profiles = profilesOf(home) as Record<string, Record<string, unknown>>
  assert.deepEqual(profiles['base'], {
    orchestrator: { model: 'opencode-go/deepseek-v4-flash' },
    reviewer: { model: 'nan/kimi-k2' }
  })
})
