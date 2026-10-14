import { stat, lstat, readFile, readdir, appendFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredProjects = ['blankdiss', 'reports', 'treage', 'insider'];
const sourceProjects = ['blankdiss', 'reports', 'insider'];

function localClock(now) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(item => item.type !== 'literal').map(item => [item.type, Number(item.value)]));
}

export function reportDate(now) {
  const local = localClock(now);
  return new Date(Date.UTC(local.year, local.month - 1, local.day - (local.hour < 6 ? 1 : 0))).toISOString().slice(0, 10);
}

function validData(data, producer, expected) {
  const local = data?.execution_environment === 'local';
  const validRunId = local
    ? /^local-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(String(data.run_id)) && /^[0-9a-f]{64}$/.test(data.working_tree_sha256 || '')
    : /^[1-9][0-9]*$/.test(String(data?.run_id));
  if (!data || data.version !== 1 || data.producer !== producer || data.status !== 'complete' ||
      data.session !== 'evening' || data.batch_date !== expected ||
      !/^[0-9a-f]{40}$/.test(data.revision || '') || !validRunId ||
      !Number.isInteger(data.run_attempt) || data.run_attempt < 1) return false;
  const created = new Date(data.run_created_at), completed = new Date(data.completed_at);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(completed.getTime()) || completed < created) return false;
  const hour = localClock(created).hour;
  if ((hour >= 6 && hour < 18) || reportDate(created) !== expected) return false;
  return producer !== 'treage' || sourceProjects.every(source => validData(data.sources?.[source], source, expected));
}

async function fileHashes(directory, prefix = '') {
  const hashes = {};
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const filename = path.join(directory, relative);
    if ((await lstat(filename)).isSymbolicLink()) throw new Error('Symbolisk länk i webbpaketet');
    if (entry.isDirectory()) Object.assign(hashes, await fileHashes(directory, relative));
    else if (entry.isFile() && relative !== 'evening.json') {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      hashes[relative] = hash.digest('hex');
    } else if (!entry.isFile()) throw new Error('Ogiltig fil i webbpaketet');
  }
  return hashes;
}

async function readReceipt(directory, producer, expected) {
  const receipt = JSON.parse(await readFile(path.join(directory, 'evening.json'), 'utf8'));
  const local = receipt.execution_environment === 'local';
  const validWebRunId = local
    ? /^local-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(String(receipt.web_run_id)) && /^[0-9a-f]{64}$/.test(receipt.working_tree_sha256 || '')
    : /^[1-9][0-9]*$/.test(String(receipt.web_run_id));
  if (receipt.version !== 1 || receipt.producer !== producer || receipt.batch_date !== expected ||
      !validData(receipt.data, producer, expected) || !receipt.files?.['index.html'] ||
      !validWebRunId || !Number.isInteger(receipt.web_run_attempt)) {
    throw new Error('Kvällens färdiga datakörning eller webbbygge saknar giltigt kvitto');
  }
  const actual = await fileHashes(directory);
  if (Object.keys(actual).length !== Object.keys(receipt.files).length ||
      Object.entries(actual).some(([name, hash]) => receipt.files[name] !== hash)) {
    throw new Error('Webbfilerna matchar inte det verifierade bygget');
  }
  return receipt;
}

export async function publicationReadiness({ directory = 'dist', event = 'schedule', now = new Date(), presentationRefresh = false } = {}) {
  const missing = [];
  for (const project of requiredProjects) {
    try {
      if (!(await stat(path.join(directory, project, 'index.html'))).isFile()) missing.push(project);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      missing.push(project);
    }
  }
  if (missing.length) return { ready: false, reason: 'Inväntar leverans: ' + missing.join(', ') };
  let expected = reportDate(now);
  const receipts = {};
  if (presentationRefresh) {
    if (event !== 'workflow_dispatch') return { ready: false, reason: 'Webbuppdatering kräver en uttrycklig manuell start.' };
    const local = localClock(now);
    const previous = new Date(Date.UTC(local.year, local.month - 1, local.day - 1)).toISOString().slice(0, 10);
    try {
      const candidate = JSON.parse(await readFile(path.join(directory, 'treage', 'evening.json'), 'utf8')).batch_date;
      if (![expected, previous].includes(candidate)) return { ready: false, reason: 'Webbuppdateringen saknar ett aktuellt komplett kvällsunderlag.' };
      expected = candidate;
    } catch { return { ready: false, reason: 'Webbuppdateringen saknar ett verifierat kvällskvitto.' }; }
  }
  for (const project of requiredProjects) {
    try { receipts[project] = await readReceipt(path.join(directory, project), project, expected); }
    catch (error) { return { ready: false, reason: `Inväntar verifierad leverans för ${expected}: ${project} (${error.message})` }; }
  }
  if (presentationRefresh && requiredProjects.some(project => !/^[0-9a-f]{40}$/.test(receipts[project].web_revision || ''))) {
    return { ready: false, reason: 'Webbuppdateringen kräver nya byggen med spårbar presentationsversion för alla fyra projekt.' };
  }
  for (const source of sourceProjects) {
    const used = receipts.treage.data.sources[source], delivered = receipts[source].data;
    if (['run_id', 'run_attempt', 'revision', 'batch_date'].some(key => used[key] !== delivered[key])) {
      return { ready: false, reason: `Treage och ${source} bygger på olika datakörningar; inväntar samma kvällsomgång.` };
    }
  }
  const clock = localClock(now), minutes = clock.hour * 60 + clock.minute;
  if (event === 'push' && minutes >= 6 * 60 && minutes < 21 * 60 + 10) {
    return { ready: false, reason: 'Alla projekt levererade; inväntar kvällspubliceringen 21:10.' };
  }
  return { ready: true, reason: `Alla fyra projekt har verifierade webbpaket för ${expected} från samma datakörningar.` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await publicationReadiness({ event: process.env.GITHUB_EVENT_NAME || 'schedule', presentationRefresh: process.env.PRESENTATION_REFRESH === 'true' });
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'ready=' + result.ready + '\n');
}
