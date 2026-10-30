import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub deployments preserve Dashboard-managed runtime settings after admin handover', async () => {
  const configuration = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(configuration.keep_vars, true, 'Wrangler must retain existing Dashboard variables on deploy.');
  assert.equal(Object.hasOwn(configuration, 'vars'), false, 'Source variables must not overwrite the handed-over admin allowlist or public URL.');
  for (const environment of Object.values(configuration.env || {})) {
    assert.equal(Object.hasOwn(environment, 'vars'), false, 'Named environments must not reintroduce source-managed runtime variables.');
  }
});
