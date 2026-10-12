import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, pbkdf2Sync, createCipheriv, createHash } from 'node:crypto';

const password = process.env.TREAGEWEB_PASSWORD;
if (!password) throw new Error('TREAGEWEB_PASSWORD måste vara satt.');
const input = path.resolve(process.argv[2] || 'dist');
const output = path.resolve(process.argv[3] || 'public');
if (output === input || input.startsWith(output + path.sep) || output.startsWith(input + path.sep)) {
  throw new Error('Indata och utdata måste vara separata kataloger.');
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf' };
const files = Object.create(null);
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symboliska länkar tillåts inte i dist.');
    if (entry.isDirectory()) await collect(path.join(dir, entry.name), relative + '/');
    else if (entry.isFile()) files[relative] = {
      type: types[path.extname(entry.name).toLowerCase()] || 'application/octet-stream',
      body: await readFile(path.join(dir, entry.name)),
    };
  }
}
await collect(input);
files['treageweb-style.css'] = {
  type: types['.css'],
  body: await readFile(new URL('../web/style.css', import.meta.url)),
};
const projects = ['treage', 'blankdiss', 'reports', 'insider'].filter(name => files[name + '/index.html']);
if (!projects.length) throw new Error('dist saknar webbplatser med index.html; ingen tom webb publiceras.');
for (const name of ['index.html', '404.html', 'sw.js', 'gate.html', 'gate.js']) {
  if (files[name]) throw new Error('Reserverat filnamn i dist: ' + name);
}
const labels = { treage: 'Treage', blankdiss: 'Blankdiss', reports: 'Reports', insider: 'Insider' };
const childProjects = ['blankdiss', 'reports', 'insider'];
const descriptions = {
  treage: 'Sammanvägning och tvärkällsanalys av Blankdiss, Reports och Insider.',
  blankdiss: 'Blankningsdata, händelser och blankningsbaserade analyser.',
  reports: 'Rapporter, konsensus och kursreaktioner.',
  insider: 'Insynstransaktioner och insiderbaserade analyser.',
};
const projectCard = (name, featured = false) => {
  const available = projects.includes(name);
  const href = name === 'treage' ? './treage/index.html' : `./${name}/`;
  const content = `<span class="eyebrow">${featured ? 'HUVUDSIDA' : 'UNDERLAG'}</span><h2>${labels[name]}</h2><p>${descriptions[name]}</p><strong class="project-open">${available ? `Öppna ${labels[name]} →` : 'Webb inväntar leverans'}</strong>`;
  return available
    ? `<a class="card project-card${featured ? ' featured' : ''}" href="${href}">${content}</a>`
    : `<div class="card project-card unavailable${featured ? ' featured' : ''}" aria-disabled="true">${content}</div>`;
};
const projectMenu = projectCard('treage', true) + childProjects.map(name => projectCard(name)).join('');
const home = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Treage sammanväger analyser från Blankdiss, Reports och Insider."><title>Treage – samlad analys</title><link rel="stylesheet" href="./treageweb-style.css"></head><body><a class="skip-link" href="#main">Till innehållet</a><header class="hero"><div class="container"><div class="brand">Treage<span class="brand-note">TVÄRKÄLLSANALYS</span></div><h1>Samlad analys av marknadens informationskällor</h1><p class="lead">Treage väger samman tidsstämplade resultat från Blankdiss, Reports och Insider och undersöker möjliga köp- och säljsignaler.</p></div></header><main id="main" class="container main-content"><nav class="project-menu" aria-label="Öppna Treage och dess källprojekt">${projectMenu}</nav><section class="cards" aria-label="Treages status"><article class="card"><span class="label">Källor</span><strong>3</strong><p>Blankdiss, Reports och Insider</p></article><article class="card"><span class="label">Aktiva signaler</span><strong>0</strong><p>Inga sammanvägda regler är validerade</p></article><article class="card"><span class="label">Arbetssätt</span><strong>Point-in-time</strong><p>Beslut bygger bara på då tillgänglig information</p></article><article class="card"><span class="label">Status</span><strong>Research</strong><p>Regler följs innan de kan aktiveras</p></article></section><section class="panel"><div class="section-header"><span class="eyebrow">SIGNALSTATUS</span><h2>Ingen validerad sammanvägd signal publiceras ännu</h2><p>Historiska samband och experiment är undersökningsunderlag. En signal kräver en tydlig regel, tillräcklig datatäckning och prospektiv validering.</p></div></section></main><footer class="container footer"><span>Treage · Tvärkällsanalys</span><button id="logout" type="button">Lås webben</button></footer><script>document.getElementById('logout').onclick=()=>{navigator.serviceWorker.controller?.postMessage({type:'lock'});location.reload()}</script></body></html>`;
files['index.html'] = { type: types['.html'], body: Buffer.from(home) };
const salt = randomBytes(16), iterations = 600000;
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
function encrypt(body) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64'), body: encrypted };
}
const verifier = encrypt(Buffer.from('Treageweb encrypted website v1'));
const manifestFiles = Object.create(null);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const [relative, file] of Object.entries(files)) {
  const encrypted = encrypt(file.body);
  const encryptedPath = 'encrypted/' + relative + '.bin';
  const destination = path.join(output, encryptedPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, encrypted.body);
  manifestFiles[relative] = { type: file.type, path: encryptedPath, iv: encrypted.iv };
}
key.fill(0);
const manifest = JSON.stringify({
  version: 1,
  salt: salt.toString('base64'),
  iterations,
  verifier: { iv: verifier.iv, ciphertext: verifier.body.toString('base64') },
  files: manifestFiles,
});
const manifestName = 'manifest-' + createHash('sha256').update(manifest).digest('hex') + '.json';
const gate = await readFile(new URL('../web/gate.html', import.meta.url), 'utf8');
const shell = gate.replace('__ROOT__', './');
await writeFile(path.join(output, 'gate.html'), shell);
const basePath = '/' + (process.env.SITE_BASE_PATH || '').replace(/^\/+|\/+$/g, '');
await writeFile(path.join(output, '404.html'), gate.replace('__ROOT__', basePath.replace(/\/$/, '') + '/'));
for (const file of Object.keys(files).filter(name => name.endsWith('.html'))) {
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  const root = '../'.repeat(file.split('/').length - 1) || './';
  await writeFile(path.join(output, file), gate.replace('__ROOT__', root));
}
await writeFile(path.join(output, manifestName), manifest);
await writeFile(path.join(output, 'gate.js'), await readFile(new URL('../web/gate.js', import.meta.url)));
const worker = (await readFile(new URL('../web/sw.js', import.meta.url), 'utf8')).replace('__MANIFEST__', manifestName);
await writeFile(path.join(output, 'sw.js'), worker);
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Krypterade ${Object.keys(files).length} filer från ${projects.length} projekt i separata paket.`);
