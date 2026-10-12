import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicationReadiness, requiredProjects } from '../scripts/readiness.mjs';

async function withDeliveries(projects, action) {
  const directory = await mkdtemp(path.join(tmpdir(), 'treageweb-ready-'));
  try {
    for (const project of projects) {
      await mkdir(path.join(directory, project));
      await writeFile(path.join(directory, project, 'index.html'), '<h1>Delivered</h1>');
    }
    await action(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('empty or partial delivery never permits publishing, even manually', async () => {
  for (const projects of [[], ['blankdiss'], ['blankdiss', 'reports', 'treage']]) {
    await withDeliveries(projects, async directory => {
      for (const event of ['schedule', 'push', 'workflow_dispatch']) {
        const result = await publicationReadiness({ directory, event });
        assert.equal(result.ready, false);
        assert.match(result.reason, /Inväntar leverans/);
      }
    });
  }
});
test('last delivery permits evening publishing; earlier push waits until 21:00 Stockholm', async () => {
  await withDeliveries(requiredProjects, async directory => {
    for (const [timestamp, ready] of [
      ['2026-10-12T18:45:00Z', false], // 20:45 summer time
      ['2026-10-12T19:00:00Z', true],
      ['2026-10-12T22:30:00Z', true], // delayed until after midnight
      ['2026-10-13T04:00:00Z', false],
      ['2026-12-12T19:45:00Z', false], // 20:45 winter time
      ['2026-12-12T20:00:00Z', true],
    ]) assert.equal((await publicationReadiness({ directory, event: 'push', now: new Date(timestamp) })).ready, ready, timestamp);
  });
});
test('scheduled and manual checks can publish complete deliveries despite scheduler delay', async () => {
  await withDeliveries(requiredProjects, async directory => {
    for (const event of ['schedule', 'workflow_dispatch']) {
      assert.equal((await publicationReadiness({ directory, event, now: new Date('2026-10-13T08:00:00Z') })).ready, true);
    }
  });
});
