import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { RoutingProfile, RoutingRole, RoutingView, RoutingWriteResult } from '../shared/ipc.ts'

/**
 * The engine's real profile store (S21): `profiles.json` in gentle-pi's own config home,
 * the same file `lib/agent-profiles.ts` reads. A session freezes the active profile at its
 * own start, so a change written here takes effect for the next session — no
 * materialization step exists or is needed. The orchestrator additionally needs Pi's own
 * `settings.json` (`defaultProvider` / `defaultModel`) for its default in future sessions.
 *
 * The store may carry hand-written keys this app does not own (`workflow`, `current`,
 * unknown profile names), so every write re-serializes the whole document instead of
 * replacing it, and a file this app cannot trust is reported and left byte-identical
 * rather than rewritten.
 */

const PROFILES_KIND = 'gentle-pi.agent_model_profiles'
const PROFILES_VERSION = 1

/** The reserved role inside a profile: the orchestrator, which is not an agent. */
const ORCHESTRATOR_KEY = 'orchestrator'

/** The overrides pseudo-profile: it holds session overrides and is never a profile tab. */
const CURRENT_KEY = 'current'

/**
 * A model reference is one `provider/id` pair. Both halves accept exactly the characters
 * the engine's own `SAFE_MODEL_ID_PATTERN` accepts (`lib/model-routing-authority.ts`), and
 * the id half may itself carry slashes (`org/nested/model`).
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._~:@/+%-]+$/

/**
 * The engine's own rule for role names (`isSafeAgentName`, same module), mirrored here so
 * this app never writes a role the engine would silently drop.
 */
const SAFE_AGENT_NAME_PATTERN = /^[A-Za-z0-9._:@/+%-]+$/

export function profilesFile(configHome: string): string {
  return join(configHome, 'profiles.json')
}

export function parseModelRef(model: string): { provider: string; id: string } | null {
  const trimmed = model.trim()
  const separator = trimmed.indexOf('/')
  if (separator < 1) return null
  const provider = trimmed.slice(0, separator)
  const id = trimmed.slice(separator + 1)
  if (id.length === 0 || !SAFE_ID_PATTERN.test(provider) || !SAFE_ID_PATTERN.test(id)) return null
  return { provider, id }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function roleView(name: string, entry: unknown): RoutingRole {
  // The engine also accepts a role written as a bare string (`"reviewer": "nan/kimi-k2"`,
  // `normalizeRoutingEntry`), which is a stored model — showing it as "inherit" would lie.
  if (typeof entry === 'string') return { name, model: entry, thinking: null }
  const model = isRecord(entry) && typeof entry['model'] === 'string' ? entry['model'] : null
  const thinking = isRecord(entry) && typeof entry['thinking'] === 'string' ? entry['thinking'] : null
  return { name, model, thinking }
}

// ---- Reading ----

/**
 * Reads the routing view over the store in `configHome`. A missing store is `missing` with
 * no profiles; malformed JSON, a wrong `kind` or version, or a `profiles` value that is not
 * an object makes the whole file `invalid` — the app never guesses about a store it cannot
 * fully understand.
 */
export function readRouting(configHome: string): RoutingView {
  const file = profilesFile(configHome)
  const base: RoutingView = { configHome, fileStatus: 'missing', active: null, profiles: [] }

  if (!existsSync(file)) return base

  let doc: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isRecord(parsed)) return { ...base, fileStatus: 'invalid' }
    doc = parsed
  } catch {
    return { ...base, fileStatus: 'invalid' }
  }

  if (doc['kind'] !== PROFILES_KIND || doc['version'] !== PROFILES_VERSION) {
    return { ...base, fileStatus: 'invalid' }
  }
  if (!isRecord(doc['profiles'])) return { ...base, fileStatus: 'invalid' }

  const profiles = doc['profiles'] as Record<string, unknown>
  const active = typeof doc['active'] === 'string' ? doc['active'] : null

  const view: RoutingProfile[] = []
  for (const [name, value] of Object.entries(profiles)) {
    if (name === CURRENT_KEY || !isRecord(value)) continue

    const roles = Object.entries(value)
    view.push({
      name,
      active: name === active,
      orchestrator:
        roleView(ORCHESTRATOR_KEY, value[ORCHESTRATOR_KEY] ?? {}),
      agents: roles
        .filter(([role]) => role !== ORCHESTRATOR_KEY)
        .map(([role, entry]) => roleView(role, entry))
        .sort((left, right) => left.name.localeCompare(right.name))
    })
  }
  view.sort((left, right) => left.name.localeCompare(right.name))

  return { configHome, fileStatus: 'valid', active, profiles: view }
}

// ---- Writing ----

type LoadedStore =
  | { ok: true; doc: Record<string, unknown>; profiles: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Loads the store for a write, refusing anything it cannot trust. A missing file and a
 * malformed one are different refusals, because they need different words from the app —
 * but both leave the disk untouched.
 */
function loadStore(configHome: string): LoadedStore {
  const file = profilesFile(configHome)
  if (!existsSync(file)) {
    return {
      ok: false,
      error: 'The profiles file is missing, so there is nothing to change yet. Start a session once so the engine creates it.'
    }
  }

  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return {
      ok: false,
      error: 'The profiles file could not be read, so it cannot be changed safely. Nothing was written.'
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: 'The profiles file is not valid JSON, so it cannot be changed safely. Nothing was written.'
    }
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: 'The profiles file does not hold a profile store, so it cannot be changed safely. Nothing was written.'
    }
  }
  if (parsed['kind'] !== PROFILES_KIND || parsed['version'] !== PROFILES_VERSION) {
    return {
      ok: false,
      error: 'The profiles file has an unexpected kind or version, so it cannot be changed safely. Nothing was written.'
    }
  }
  if (!isRecord(parsed['profiles'])) {
    return {
      ok: false,
      error: 'The profiles file has an unexpected shape, so it cannot be changed safely. Nothing was written.'
    }
  }
  return { ok: true, doc: parsed, profiles: parsed['profiles'] as Record<string, unknown> }
}

/**
 * Validates the profile a write targets: it must exist in the store and must not be the
 * `current` overrides holder, which is not a profile.
 */
function loadProfile(
  profiles: Record<string, unknown>,
  profile: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (profile === CURRENT_KEY) {
    return {
      ok: false,
      error: '"current" holds session overrides, not a profile. Please pick one of the named profiles.'
    }
  }
  if (!Object.prototype.hasOwnProperty.call(profiles, profile)) {
    return { ok: false, error: `Profile "${profile}" does not exist in the profiles file.` }
  }
  if (!isRecord(profiles[profile])) {
    return {
      ok: false,
      error: `The entry for profile "${profile}" has an unexpected shape, so it cannot be changed safely. Nothing was written.`
    }
  }
  return { ok: true, value: profiles[profile] as Record<string, unknown> }
}

/**
 * Replace a JSON store through a sibling temp file and a rename, the same discipline the
 * engine's own stores follow (`lib/agent-profiles.ts`): the destination is only ever
 * swapped for a complete file, and the temp file is removed on every failure path.
 */
function writeFileAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let descriptor: number
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The open failed, so the temp path may simply not exist — nothing to clean up.
    }
    throw error
  }
  const failures: unknown[] = []
  try {
    writeFileSync(descriptor, text)
  } catch (error) {
    failures.push(error)
  }
  try {
    closeSync(descriptor)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 0) {
    try {
      renameSync(temporary, path)
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    unlinkSync(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(error)
  }
  if (failures.length > 0) throw failures[0]
}

function refusal(error: string): RoutingWriteResult {
  return { ok: false, error }
}

/** Serializes the whole document, unknown keys included, the way the engine's stores do. */
function serialize(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Persists a mutated document, skipping the write when the text would be identical.
 * Replacing a file with identical bytes is not a change, so it must not churn the file.
 */
function persist(configHome: string, doc: Record<string, unknown>): RoutingWriteResult {
  const file = profilesFile(configHome)
  const text = serialize(doc)
  try {
    if (readFileSync(file, 'utf8') === text) return { ok: true }
  } catch {
    // Fall through: the file disappeared between load and write; the atomic write below
    // recreates it from the document that was validated a moment ago.
  }
  try {
    writeFileAtomically(file, text)
  } catch {
    return refusal('The profiles file could not be saved. Nothing was changed — please try again.')
  }
  return { ok: true }
}

/**
 * Sets or clears one agent's model inside one profile. A `null` model clears the role,
 * which is removed when nothing else (thinking, tier) keeps it meaningful. The role's
 * other fields are kept exactly as they were.
 */
export function setAgentModel(
  configHome: string,
  profile: string,
  agent: string,
  model: string | null
): RoutingWriteResult {
  const store = loadStore(configHome)
  if (!store.ok) return refusal(store.error)

  const loaded = loadProfile(store.profiles, profile)
  if (!loaded.ok) return refusal(loaded.error)

  if (agent.length === 0) {
    return refusal('Please name the agent whose model should change.')
  }
  if (agent === ORCHESTRATOR_KEY) {
    return refusal('"orchestrator" is the reserved orchestrator role, not an agent.')
  }
  // The engine drops a role whose name fails its own safe-name rule, so this app refuses
  // exactly those names instead of writing an entry the engine would silently ignore.
  // `__proto__` passes the character class but cannot be written as an own key on a plain
  // object, so it is refused explicitly.
  if (!SAFE_AGENT_NAME_PATTERN.test(agent) || agent === '__proto__') {
    return refusal(
      'Please use an agent name the engine accepts: letters, numbers, dots, dashes, underscores, colons, at signs, slashes, plus signs and percent signs. Nothing was written.'
    )
  }
  const trimmed = model === null ? null : model.trim()
  if (trimmed !== null && parseModelRef(trimmed) === null) {
    return refusal('Please use a provider/id model pair, like "provider/model".')
  }

  const roles = loaded.value
  const role: Record<string, unknown> = isRecord(roles[agent]) ? { ...(roles[agent] as Record<string, unknown>) } : {}
  if (trimmed === null) delete role['model']
  else role['model'] = trimmed

  if (Object.keys(role).length === 0) delete roles[agent]
  else roles[agent] = role

  return persist(configHome, store.doc)
}

/**
 * Sets the profile's orchestrator model, keeping its thinking and tier neighbours. The
 * result also says whether the edited profile is the store's `active` one: only then does
 * the caller touch Pi's `settings.json` or the running session, which belong to the
 * active profile alone.
 */
export function setOrchestratorModel(
  configHome: string,
  profile: string,
  model: string
): { ok: true; profileActive: boolean } | { ok: false; error: string } {
  const store = loadStore(configHome)
  if (!store.ok) return { ok: false, error: store.error }

  const loaded = loadProfile(store.profiles, profile)
  if (!loaded.ok) return { ok: false, error: loaded.error }

  if (parseModelRef(model) === null) {
    return { ok: false, error: 'Please use a provider/id model pair, like "provider/model".' }
  }

  const roles = loaded.value
  const role: Record<string, unknown> = isRecord(roles[ORCHESTRATOR_KEY])
    ? { ...(roles[ORCHESTRATOR_KEY] as Record<string, unknown>) }
    : {}
  role['model'] = model.trim()
  roles[ORCHESTRATOR_KEY] = role

  const persisted = persist(configHome, store.doc)
  if (!persisted.ok) return { ok: false, error: persisted.error }
  return { ok: true, profileActive: store.doc['active'] === profile }
}

/** Writes the top-level `active` marker, the one the next session freezes. */
export function setActiveProfile(configHome: string, profile: string): RoutingWriteResult {
  const store = loadStore(configHome)
  if (!store.ok) return refusal(store.error)

  const loaded = loadProfile(store.profiles, profile)
  if (!loaded.ok) return refusal(loaded.error)

  store.doc['active'] = profile
  return persist(configHome, store.doc)
}

// ---- The orchestrator's default in Pi's own settings ----

export type OrchestratorDefaultResult = RoutingWriteResult

/**
 * Persists the orchestrator's model as Pi's default for future sessions, into
 * `<agentHome>/settings.json` (`defaultProvider` / `defaultModel`). The thinking level is
 * left untouched, every other key — packages, theme, telemetry — survives, and a file the
 * app cannot parse as an object is refused rather than replaced.
 */
export function applyOrchestratorDefault(agentHome: string, model: string): OrchestratorDefaultResult {
  const reference = parseModelRef(model)
  if (reference === null) {
    return refusal('Please use a provider/id model pair, like "provider/model".')
  }

  const file = join(agentHome, 'settings.json')
  let doc: Record<string, unknown> = {}
  if (existsSync(file)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return refusal('The settings file is not valid JSON, so it cannot be changed safely. Nothing was written.')
    }
    if (!isRecord(parsed)) {
      return refusal('The settings file does not hold a settings object, so it cannot be changed safely. Nothing was written.')
    }
    doc = parsed
  }

  doc['defaultProvider'] = reference.provider
  doc['defaultModel'] = reference.id

  const text = serialize(doc)
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return { ok: true }
    writeFileAtomically(file, text)
  } catch {
    return refusal('The settings file could not be saved. Nothing was changed — please try again.')
  }
  return { ok: true }
}
