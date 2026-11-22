/**
 * Durable plugin state: the active rate table, its provenance, and the UI
 * switches. Kept in the DSH home so it survives restarts and profile updates.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const writeQueues = new Map()
let temporarySerial = 0

/**
 * Absolute path of the plugin state file.
 * @param config - plugin config, `dataDir` overrides the DSH home.
 * @returns absolute file path.
 */
export function statePath(config) {
  const base = config?.dataDir
    || process.env.DSH_HOME
    || join(homedir(), '.dsh')
  return join(base, 'storages', 'llm-cost', 'state.json')
}

/**
 * Read persisted state; a missing or corrupt file yields an empty record.
 * @param path - absolute file path.
 * @returns parsed state or `{}`.
 */
export async function readState(path) {
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Write state atomically (temporary file plus rename).
 * @param path - absolute file path.
 * @param value - JSON-serializable state.
 */
export async function writeState(path, value) {
  const previous = writeQueues.get(path) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true })
    temporarySerial += 1
    const temporary = `${path}.${process.pid}.${temporarySerial}.tmp`
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporary, path)
  })
  writeQueues.set(path, queued)
  try {
    await queued
  } finally {
    if (writeQueues.get(path) === queued) writeQueues.delete(path)
  }
}
