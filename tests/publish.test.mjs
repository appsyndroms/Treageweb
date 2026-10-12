import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const password = 'integration-test-only-åäö';
let temp, input, output, workerText;
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'treageweb-test-'));
  input = path.join(temp, 'dist'); output = path.join(temp, 'public');
  await mkdir(path.join(input, 'blankdiss'), { recursive: true });
  await writeFile(path.join(input, 'blankdiss/index.html'), '<h1>PRIVATE_REPORT_MARKER</h1>');
  await writeFile(path.join(input, 'blankdiss/data.json'), '{"privateValue":123456789}');
  await writeFile(path.join(input, 'blankdiss/style.css'), 'body{color:red}');
  await mkdir(path.join(input, 'insider'), { recursive: true });
  await writeFile(path.join(input, 'insider/index.html'), '<h1>Insider</h1>');
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  workerText = await readFile(path.join(output, 'sw.js'), 'utf8');
});
after(async () => { await rm(temp, { recursive: true, force: true }); });
function build(secret = password, source = input) {
  return spawnSync(process.execPath, ['scripts/build.mjs', source, output], {
    cwd: repo, env: { ...process.env, TREAGEWEB_PASSWORD: secret, SITE_BASE_PATH: '/Treageweb' }, encoding: 'utf8',
  });
}
function worker() {
  const events = {};
  const context = vm.createContext({
    self: { registration: { scope: 'https://example.org/Treageweb/' }, addEventListener: (name, fn) => { events[name] = fn; } },
    URL, Response, TextEncoder, TextDecoder, Uint8Array, atob, crypto: webcrypto,
    fetch: async url => new Response(await readFile(path.join(output, new URL(url).pathname.replace(/^\/Treageweb\//, '')))),
  });
  vm.runInContext(workerText, context);
  return {
    async unlock(secret) {
      let pending, answer;
      events.message({ data: { type: 'unlock', password: secret }, ports: [{ postMessage: value => { answer = value; } }], waitUntil: promise => { pending = promise; } });
      await pending; return answer.ok;
    },
    lock() { events.message({ data: { type: 'lock' } }); },
    request(file, mode = 'navigate') {
      let response;
      events.fetch({ request: { url: 'https://example.org/Treageweb/' + file, mode }, respondWith: value => { response = value; } });
      return response;
    },
  };
}
test('public output contains no source data or password; direct data URL is absent', async () => {
  async function check(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await check(file);
      else {
        const text = await readFile(file, 'utf8');
        assert.ok(!text.includes('PRIVATE_REPORT_MARKER'));
        assert.ok(!text.includes('123456789'));
        assert.ok(!text.includes(password));
      }
    }
  }
  await check(output);
  await assert.rejects(readFile(path.join(output, 'blankdiss/data.json')));
  const manifest = JSON.parse(await readFile(path.join(output, (await readdir(output)).find(name => name.startsWith('manifest-'))), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.files['blankdiss/data.json']);
  const version = (await readdir(output)).find(name => name.startsWith('manifest-')).slice('manifest-'.length, -'.json'.length).slice(0, 16);
  assert.ok((await readFile(path.join(output, 'gate.js'), 'utf8')).includes(`sw.js?v=${version}`));
  assert.ok(!(await readFile(path.join(output, 'gate.html'), 'utf8')).includes('__BUILD_VERSION__'));
  assert.equal((await readFile(path.join(output, manifest.files['blankdiss/data.json'].path))).length, Buffer.byteLength('{"privateValue":123456789}') + 16);
  assert.ok((await readFile(path.join(output, 'blankdiss/index.html'), 'utf8')).includes(`../gate.js?v=${version}`));
  assert.match(await readFile(path.join(output, '404.html'), 'utf8'), /\/Treageweb\/gate.js/);
});
test('locked data denied; wrong password cannot decrypt', async () => {
  const sw = worker();
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  assert.equal(await sw.unlock('wrong-password'), false);
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  assert.match(await (await sw.request('blankdiss/')).text(), /Lösenord/);
});
test('correct password unlocks HTML, query-string data, CSS and project links', async () => {
  const sw = worker();
  assert.equal(await sw.unlock(password), true);
  assert.match(await (await sw.request('blankdiss/')).text(), /PRIVATE_REPORT_MARKER/);
  const data = await sw.request('blankdiss/data.json?v=3', 'cors');
  assert.equal(data.headers.get('Content-Type'), 'application/json');
  assert.equal(data.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await data.json(), { privateValue: 123456789 });
  assert.equal(await (await sw.request('blankdiss/style.css', 'cors')).text(), 'body{color:red}');
  const home = await (await sw.request('')).text();
  assert.match(home, /\.\/blankdiss\//); assert.match(home, /\.\/insider\//);
  assert.ok(!home.includes('./reports/'));
  assert.equal((await sw.request('missing.json', 'cors')).status, 404);
  assert.equal((await sw.request('toString', 'cors')).status, 404);
});
test('locking and worker restart deny protected files again', async () => {
  const sw = worker();
  assert.equal(await sw.unlock(password), true);
  sw.lock();
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  assert.equal((await worker().request('blankdiss/data.json', 'cors')).status, 401);
});
test('build fails closed without a secret or with empty input', async () => {
  assert.notEqual(build('').status, 0);
  const empty = path.join(temp, 'empty'); await mkdir(empty);
  assert.notEqual(build(password, empty).status, 0);
});
test('tampered encrypted payload cannot unlock', async () => {
  const manifestPath = path.join(output, (await readdir(output)).find(name => name.startsWith('manifest-')));
  const original = await readFile(manifestPath, 'utf8');
  try {
    const manifest = JSON.parse(original);
    const ciphertext = Buffer.from(manifest.verifier.ciphertext, 'base64'); ciphertext[0] ^= 1;
    manifest.verifier.ciphertext = ciphertext.toString('base64');
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal(await worker().unlock(password), false);
  } finally { await writeFile(manifestPath, original); }
});
test('cleanup commits and pushes all dist deletions, preserves other files, and is idempotent', async () => {
  const remote = path.join(temp, 'remote.git'), checkout = path.join(temp, 'cleanup');
  const git = (args, cwd = temp) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git(['init', '--bare', remote]); git(['clone', remote, checkout]);
  git(['config', 'user.name', 'Test'], checkout); git(['config', 'user.email', 'test@example.org'], checkout);
  git(['checkout', '-b', 'main'], checkout);
  await mkdir(path.join(checkout, 'dist/blankdiss'), { recursive: true });
  await writeFile(path.join(checkout, 'dist/blankdiss/index.html'), 'discard');
  await writeFile(path.join(checkout, 'dist/.hidden'), 'discard too');
  await writeFile(path.join(checkout, 'README.md'), 'preserve');
  git(['add', '.'], checkout); git(['commit', '-m', 'fixture'], checkout); git(['push', 'origin', 'main'], checkout);
  const workflow = await readFile(path.join(repo, '.github/workflows/publish-pages.yml'), 'utf8');
  assert.match(workflow, /needs: publish\n    if: \$\{\{ always\(\) \}\}/);
  const script = workflow.split('      - name: Remove staged websites and push cleanup\n        run: |\n')[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  for (let i = 0; i < 2; i++) {
    const result = spawnSync('bash', ['-e', '-c', script], { cwd: checkout, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(git(['ls-tree', '-r', '--name-only', 'main'], remote).trim(), 'README.md');
  assert.equal(await readFile(path.join(checkout, 'README.md'), 'utf8'), 'preserve');
});
