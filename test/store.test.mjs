import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeState } from '../lib/store.js'

test('concurrent state writes are serialized instead of colliding on one temp file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-llm-cost-store-'))
  const path = join(directory, 'state.json')
  const writes = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => writeState(path, { value: index })),
  )
  assert.equal(writes.filter((result) => result.status === 'rejected').length, 0)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { value: 19 })
})
