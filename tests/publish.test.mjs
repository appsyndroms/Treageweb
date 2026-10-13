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
const username = 'integration-test-user';
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
    cwd: repo, env: { ...process.env, TREAGEWEB_USER: username, TREAGEWEB_PASSWORD: secret, SITE_BASE_PATH: '/Treageweb' }, encoding: 'utf8',
  });
}
function worker(sessionStore = new Map(), beforeRead = async () => {}) {
  const events = {};
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        const db = {
          createObjectStore() {},
          transaction(_name, mode) {
            const transaction = {
              objectStore() {
                return {
                  get(name) {
                    const result = {};
                    const value = sessionStore.get(name);
                    queueMicrotask(async () => { await beforeRead(); result.result = value; result.onsuccess?.(); });
                    return result;
                  },
                  put(value, name) {
                    sessionStore.set(name, value);
                    queueMicrotask(() => transaction.oncomplete?.());
                  },
                  delete(name) {
                    sessionStore.delete(name);
                    queueMicrotask(() => transaction.oncomplete?.());
                  },
                };
              },
            };
            return transaction;
          },
          close() {},
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  const context = vm.createContext({
    self: { clients: { matchAll: async () => [] }, registration: { scope: 'https://example.org/Treageweb/' }, addEventListener: (name, fn) => { events[name] = fn; } },
    URL, Response, TextEncoder, TextDecoder, Uint8Array, atob, crypto: webcrypto, indexedDB,
    fetch: async url => new Response(await readFile(path.join(output, new URL(url).pathname.replace(/^\/Treageweb\//, '')))),
  });
  vm.runInContext(workerText, context);
  return {
    async unlock(user, secret) {
      let pending, answer;
      events.message({ data: { type: 'unlock', username: user, password: secret }, ports: [{ postMessage: value => { answer = value; } }], waitUntil: promise => { pending = promise; } });
      await pending; return answer.ok;
    },
    async lock() {
      let pending;
      let acknowledged = false;
      events.message({ data: { type: 'lock' }, ports: [{ postMessage: result => { acknowledged = result.ok; assert.equal(sessionStore.has('active'), false); } }], waitUntil: promise => { pending = promise; } });
      await pending; assert.equal(acknowledged, true);
    },
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
        assert.ok(!text.includes(username));
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
  assert.equal(await sw.unlock(username, 'wrong-password'), false);
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  assert.match(await (await sw.request('blankdiss/')).text(), /Lösenord/);
});
test('correct password unlocks HTML, query-string data, CSS and project links', async () => {
  const sw = worker();
  assert.equal(await sw.unlock(username, password), true);
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
test('unlock survives worker restart without storing the password; lock clears the session', async () => {
  const sessionStore = new Map();
  const sw = worker(sessionStore);
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  assert.equal(await sw.unlock(username, password), true);
  const savedSession = sessionStore.get('active');
  assert.ok(savedSession.key);
  assert.equal(savedSession.version, (await readdir(output)).find(name => name.startsWith('manifest-')));
  assert.equal(JSON.stringify(savedSession).includes(password), false);
  const restartedWorker = worker(sessionStore);
  const page = await restartedWorker.request('blankdiss/');
  assert.match(await page.text(), /PRIVATE_REPORT_MARKER/);
  await restartedWorker.lock();
  assert.equal(sessionStore.has('active'), false);
  assert.equal((await worker(sessionStore).request('blankdiss/data.json', 'cors')).status, 401);
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
    assert.equal(await worker().unlock(username, password), false);
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
  assert.match(workflow, /needs: \[readiness, publish\]/);
  assert.ok(workflow.includes("always() && needs.readiness.outputs.ready == 'true' && needs.publish.result != 'skipped'"));
  const script = workflow.split('      - name: Remove staged websites and push cleanup\n        run: |\n')[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  for (let i = 0; i < 2; i++) {
    const result = spawnSync('bash', ['-e', '-c', script], { cwd: checkout, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(git(['ls-tree', '-r', '--name-only', 'main'], remote).trim(), 'README.md');
  assert.equal(await readFile(path.join(checkout, 'README.md'), 'utf8'), 'preserve');
});

test('locked deep links load the login script from the site root', async () => {
  const sw = worker();
  for (const route of ['reports/', 'treage/index.html', 'blankdiss/deep/route']) {
    const response = await sw.request(route);
    const html = await response.text();
    const src = html.match(/<script src="([^"]+)"/)[1];
    assert.equal(new URL(src, 'https://example.org/Treageweb/' + route).pathname, '/Treageweb/gate.js');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
test('every decrypted project page includes shared logout and worker update controls', async () => {
  const sw = worker();
  assert.equal(await sw.unlock(username, password), true);
  for (const route of ['blankdiss/index.html', 'insider/index.html', 'index.html']) {
    const html = await (await sw.request(route)).text();
    const src = html.match(/<script src="([^"]*session.js)"/)[1];
    assert.equal(new URL(src, 'https://example.org/Treageweb/' + route).pathname, '/Treageweb/session.js');
  }
  const script = await readFile(path.join(output, 'session.js'), 'utf8');
  assert.ok(!script.includes('__BUILD_VERSION__'));
  assert.match(script, /Logga ut/);
  // Session infrastructure stays accessible while the content is locked.
  assert.equal(sw.request('session.js', 'cors'), undefined);
});
test('an expired or damaged encrypted page shows a usable login form', async () => {
  const sw = worker();
  assert.equal(await sw.unlock(username, password), true);
  const file = path.join(output, 'encrypted/blankdiss/index.html.bin');
  const original = await readFile(file);
  try {
    const broken = Buffer.from(original); broken[0] ^= 1;
    await writeFile(file, broken);
    const response = await sw.request('blankdiss/index.html');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /https:\/\/example.org\/Treageweb\/gate.js/);
    assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
  } finally { await writeFile(file, original); }
});

test('a session read already in flight cannot restore access after logout', async () => {
  const saved = new Map();
  assert.equal(await worker(saved).unlock(username, password), true);
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const sw = worker(saved, async () => { started(); await barrier; });
  const response = sw.request('blankdiss/data.json', 'cors');
  await reading;
  await sw.lock();
  release();
  assert.equal((await response).status, 401);
  assert.equal((await sw.request('blankdiss/data.json', 'cors')).status, 401);
});
