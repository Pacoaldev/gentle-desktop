import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  APP_FOLDER_LABEL,
  chooseStartFolder,
  readRememberedWorkspace,
  sameFolder,
  workspaceLabel,
  writeRememberedWorkspace
} from '../src/main/workspace.ts'

/** Scratch state directories live outside the repository and are removed afterwards. */
const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gentle-desktop-workspace-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a normal project folder is shown by its last segment, with the full path for hover', () => {
  const windows = workspaceLabel('C:\\Users\\lea\\projects\\demo', null)
  assert.ok(windows !== null)
  assert.equal(windows.name, 'demo')
  assert.equal(windows.fullPath, 'C:\\Users\\lea\\projects\\demo')
  assert.equal(windows.inAppFolder, false)

  const posix = workspaceLabel('/home/lea/projects/demo', null)
  assert.ok(posix !== null)
  assert.equal(posix.name, 'demo')
  assert.equal(posix.inAppFolder, false)
})

test("the application's own directory says so instead of naming an installation folder", () => {
  const appDir = 'C:\\apps\\gentle desktop\\win-unpacked'
  const label = workspaceLabel(appDir, appDir)
  assert.ok(label !== null)
  assert.equal(label.name, APP_FOLDER_LABEL, 'the header names no installation folder')
  assert.equal(label.inAppFolder, true)
  assert.equal(label.fullPath, appDir)

  // A folder inside the application's own tree is still not a project folder.
  const nested = workspaceLabel('C:\\apps\\gentle desktop\\win-unpacked\\resources', appDir)
  assert.equal(nested?.name, APP_FOLDER_LABEL)

  // A folder outside it is named as usual.
  assert.equal(workspaceLabel('C:\\apps\\other\\demo', appDir)?.inAppFolder, false)

  if (process.platform === 'win32') {
    // Windows folder names are case-insensitive; the comparison must be too.
    assert.equal(workspaceLabel(appDir.toLowerCase(), appDir)?.inAppFolder, true)
  }
})

test('a path with no last segment still shows something identifiable', () => {
  const driveRoot = workspaceLabel('C:\\', null)
  assert.ok(driveRoot !== null)
  assert.equal(driveRoot.name, 'C:\\', 'a drive root shows the drive itself')
  assert.equal(driveRoot.fullPath, 'C:\\')

  const root = workspaceLabel('/', null)
  assert.ok(root !== null)
  assert.equal(root.name, '/')
  assert.equal(root.fullPath, '/')
})

test('the remembered folder record: valid, missing, unreadable or malformed', () => {  const stateDir = scratch()
  assert.equal(readRememberedWorkspace(stateDir), null, 'a missing record is no choice yet')

  const folder = join(stateDir, 'projects', 'demo')
  mkdirSync(folder, { recursive: true })
  writeRememberedWorkspace(stateDir, folder)
  assert.equal(readRememberedWorkspace(stateDir), folder, 'a valid record is remembered')

  writeFileSync(join(stateDir, 'workspace.json'), 'this is not json at all')
  assert.equal(readRememberedWorkspace(stateDir), null, 'an unreadable record is no choice yet')

  writeFileSync(join(stateDir, 'workspace.json'), JSON.stringify({ folder: 42 }))
  assert.equal(readRememberedWorkspace(stateDir), null, 'a malformed record is no choice yet')

  // A folder that no longer exists cannot be worked in; the record is treated as absent
  // so the app falls back to its default instead of starting an engine that cannot run.
  writeFileSync(join(stateDir, 'workspace.json'), JSON.stringify({ folder: join(stateDir, 'deleted') }))
  assert.equal(readRememberedWorkspace(stateDir), null, 'a record for a deleted folder is no choice yet')
})

test('the folder the agent is already in counts as the same folder, however it is written', () => {
  assert.equal(sameFolder('/work/demo', '/work/demo'), true)
  assert.equal(sameFolder('/work/demo/', '/work/demo'), true, 'a trailing separator is the same folder')
  assert.equal(sameFolder(String.raw`C:\work\demo`, 'C:/work/demo/'), true, 'the other separator is the same folder')
  assert.equal(sameFolder('/work/demo', '/work/demo/sub'), false, 'a subfolder is a different folder')
  assert.equal(sameFolder('/work/demo', '/work/other'), false)

  // Case is part of the name everywhere except Windows, where the filesystem ignores it.
  const caseFolded = process.platform === 'win32'
  assert.equal(sameFolder(String.raw`C:\Work\Demo`, String.raw`c:\work\demo`), caseFolded)
})


test('a first launch with no remembered folder asks for one and remembers the answer', async () => {
  let asked = 0
  const chosen = await chooseStartFolder({
    remembered: null,
    override: null,
    fallback: '/app',
    ask: async () => {
      asked += 1
      return '/picked'
    }
  })

  assert.deepEqual(chosen, { folder: '/picked', remember: true }, 'the chosen folder is started in and written down')
  assert.equal(asked, 1, 'the app asked exactly once')
})

test('a remembered folder or an explicit override starts without asking', async () => {
  let asked = 0
  const ask = async () => {
    asked += 1
    return '/picked'
  }

  assert.deepEqual(
    await chooseStartFolder({ remembered: '/before', override: null, fallback: '/app', ask }),
    { folder: '/before', remember: false },
    'the folder used last wins'
  )
  assert.deepEqual(
    await chooseStartFolder({ remembered: null, override: '/scripted', fallback: '/app', ask }),
    { folder: '/scripted', remember: false },
    'an explicit folder is an instruction, not a first run'
  )
  assert.equal(asked, 0, 'a question nobody needs is not asked')
})

test('a cancelled first-run picker launches in the default folder and remembers nothing', async () => {
  assert.deepEqual(
    await chooseStartFolder({ remembered: null, override: null, fallback: '/app', ask: async () => null }),
    { folder: '/app', remember: false },
    'cancelling launches, but nothing is remembered that the user did not choose'
  )
})
