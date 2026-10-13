import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicationReadiness, requiredProjects, reportDate } from '../scripts/readiness.mjs';

function data(producer, date) {
  return { version: 1, producer, status: 'complete', session: 'evening', batch_date: date,
    revision: 'a'.repeat(40), run_id: String(requiredProjects.indexOf(producer) + 1), run_attempt: 1,
    run_created_at: date + 'T18:10:00Z', completed_at: date + 'T18:30:00Z' };
}
async function withDeliveries(projects, action, date = '2026-10-12') {
  const directory = await mkdtemp(path.join(tmpdir(), 'treageweb-ready-'));
  try {
    const sourceData = Object.fromEntries(['blankdiss', 'reports', 'insider'].map(p => [p, data(p, date)]));
    for (const project of projects) {
      await mkdir(path.join(directory, project));
      const html = '<h1>Delivered</h1>';
      await writeFile(path.join(directory, project, 'index.html'), html);
      const receipt = { version: 1, producer: project, batch_date: date, data: data(project, date),
        web_run_id: '99', web_run_attempt: 1,
        files: { 'index.html': createHash('sha256').update(html).digest('hex') } };
      if (project === 'treage') receipt.data.sources = sourceData;
      await writeFile(path.join(directory, project, 'evening.json'), JSON.stringify(receipt));
    }
    await action(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const evening = new Date('2026-10-12T19:10:00Z');
test('empty or partial delivery never permits publishing, even manually', async () => {
  for (const projects of [[], ['blankdiss'], ['blankdiss', 'reports', 'treage']]) {
    await withDeliveries(projects, async directory => {
      for (const event of ['schedule', 'push', 'workflow_dispatch']) {
        const result = await publicationReadiness({ directory, event, now: evening });
        assert.equal(result.ready, false);
        assert.match(result.reason, /Inväntar leverans/);
      }
    });
  }
});
test('last matching delivery permits evening publishing in summer and winter', async () => {
  for (const [timestamp, ready] of [
    ['2026-10-12T18:45:00Z', false], ['2026-10-12T19:05:00Z', false],
    ['2026-10-12T19:10:00Z', true], ['2026-10-12T22:30:00Z', true],
    ['2026-12-12T19:45:00Z', false], ['2026-12-12T20:05:00Z', false], ['2026-12-12T20:10:00Z', true],
  ]) await withDeliveries(requiredProjects, async directory => {
    assert.equal((await publicationReadiness({ directory, event: 'push', now: new Date(timestamp) })).ready, ready, timestamp);
  }, reportDate(new Date(timestamp)));
});
test('late delivery after midnight retains the previous evening date', async () => {
  await withDeliveries(requiredProjects, async directory => {
    for (const event of ['schedule', 'workflow_dispatch', 'push']) {
      assert.equal((await publicationReadiness({ directory, event, now: new Date('2026-10-13T01:00:00Z') })).ready, true);
    }
    assert.equal((await publicationReadiness({ directory, event: 'schedule', now: new Date('2026-10-13T08:00:00Z') })).ready, false);
  });
});
test('four legacy websites without receipts cannot be published', async () => {
  await withDeliveries(requiredProjects, async directory => {
    await rm(path.join(directory, 'blankdiss', 'evening.json'));
    assert.equal((await publicationReadiness({ directory, event: 'workflow_dispatch', now: evening })).ready, false);
  });
});
test('old or mixed report dates cannot be published', async () => {
  await withDeliveries(requiredProjects, async directory => {
    const filename = path.join(directory, 'reports', 'evening.json');
    const receipt = JSON.parse(await readFile(filename)); receipt.batch_date = '2026-10-11';
    await writeFile(filename, JSON.stringify(receipt));
    assert.equal((await publicationReadiness({ directory, now: evening })).ready, false);
  });
});
test('Treage must have consumed the same source runs as the delivered children', async () => {
  await withDeliveries(requiredProjects, async directory => {
    const filename = path.join(directory, 'treage', 'evening.json');
    const receipt = JSON.parse(await readFile(filename)); receipt.data.sources.insider.run_id = '999';
    await writeFile(filename, JSON.stringify(receipt));
    const result = await publicationReadiness({ directory, now: evening });
    assert.equal(result.ready, false); assert.match(result.reason, /olika datakörningar/);
  });
});
test('modified or extra files invalidate the saved website proof', async () => {
  for (const name of ['index.html', 'extra.json']) await withDeliveries(requiredProjects, async directory => {
    await writeFile(path.join(directory, 'insider', name), 'changed');
    assert.equal((await publicationReadiness({ directory, now: evening })).ready, false);
  });
});
test('morning runs cannot masquerade as a completed evening collection', async () => {
  await withDeliveries(requiredProjects, async directory => {
    const filename = path.join(directory, 'insider', 'evening.json');
    const receipt = JSON.parse(await readFile(filename)); receipt.data.run_created_at = '2026-10-12T04:40:00Z';
    await writeFile(filename, JSON.stringify(receipt));
    assert.equal((await publicationReadiness({ directory, now: evening })).ready, false);
  });
});

test('an explicit presentation refresh reuses yesterday only with four new verified builds', async () => {
  await withDeliveries(requiredProjects, async directory => {
    const now = new Date('2026-10-13T09:00:00Z');
    assert.equal((await publicationReadiness({directory, event: 'workflow_dispatch', now, presentationRefresh: true})).ready, false);
    for (const project of requiredProjects) {
      const file = path.join(directory, project, 'evening.json');
      const receipt = JSON.parse(await readFile(file)); receipt.web_revision = 'b'.repeat(40);
      await writeFile(file, JSON.stringify(receipt));
    }
    assert.equal((await publicationReadiness({directory, event: 'workflow_dispatch', now, presentationRefresh: true})).ready, true);
    for (const event of ['push', 'schedule', 'workflow_dispatch']) {
      assert.equal((await publicationReadiness({directory, event, now})).ready, false);
    }
    for (const event of ['push', 'schedule']) {
      assert.equal((await publicationReadiness({directory, event, now, presentationRefresh: true})).ready, false);
    }
    assert.equal((await publicationReadiness({directory, event: 'workflow_dispatch', now: new Date('2026-10-14T09:00:00Z'), presentationRefresh: true})).ready, false);
    const file = path.join(directory, 'insider', 'evening.json');
    const receipt = JSON.parse(await readFile(file)); receipt.data.run_id = '999';
    await writeFile(file, JSON.stringify(receipt));
    assert.equal((await publicationReadiness({directory, event: 'workflow_dispatch', now, presentationRefresh: true})).ready, false);
  });
});
