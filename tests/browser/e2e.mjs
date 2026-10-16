// Chromium browser acceptance suite for Archive Lab and Khidma Desk.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appPath = '/apps/archive-lab/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function chromePath() {
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('Chrome or Chromium is required for the browser acceptance suite.');
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relativePath = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
      const filename = path.resolve(root, '.' + relativePath);
      if (filename !== root && !filename.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      const bytes = await readFile(filename);
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + appPath }));
  });
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; last = result; }
    catch (error) { last = error; }
    await wait(100);
  }
  throw new Error('Timeout waiting for ' + label + (last instanceof Error ? ': ' + last.message : ''));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('Chrome DevTools connection timeout')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools WebSocket failed')); }, { once: true });
  });
}

function client(socket) {
  let sequence = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer, method });
    const packet = { id, method, params };
    if (sessionId) packet.sessionId = sessionId;
    socket.send(JSON.stringify(packet));
  });
  socket.addEventListener('message', (event) => {
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (packet.id && pending.has(packet.id)) {
      const item = pending.get(packet.id);
      pending.delete(packet.id); clearTimeout(item.timer);
      if (packet.error) item.reject(new Error(item.method + ': ' + packet.error.message));
      else item.resolve(packet.result || {});
    } else if (packet.method === 'Page.javascriptDialogOpening' && packet.sessionId) {
      void send('Page.handleJavaScriptDialog', { accept: true }, packet.sessionId).catch(() => {});
    }
  });
  return { send };
}

const temp = await mkdtemp(path.join(tmpdir(), 'archive-lab-browser-'));
const downloads = path.join(temp, 'downloads');
const profile = path.join(temp, 'profile');
await mkdir(downloads);
await mkdir(profile);
let server;
let browser;
let socket;
const browserErrors = [];

try {
  const web = await serve();
  server = web.server;
  browser = spawn(chromePath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-default-apps', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => browserErrors.push(chunk));
  const portFile = path.join(profile, 'DevToolsActivePort');
  const portData = await until(async () => {
    if (browser.exitCode !== null) throw new Error('Chrome exited: ' + browserErrors.join('').slice(-1500));
    try { return await readFile(portFile, 'utf8'); } catch { return null; }
  }, 'Chrome startup', 15000);
  const parts = portData.trim().split('\n');
  socket = await connect('ws://127.0.0.1:' + Number(parts[0]) + parts[1]);
  const cdp = client(socket);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attachment = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const session = attachment.sessionId;
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser script error');
    return result.result?.value;
  }
  async function waitFor(expression, label, timeout) {
    return until(async () => evaluate(expression), label, timeout || 10000);
  }
  async function uploadKhidmaArchive(text, filename) {
    const expression = "(async () => { const input=document.querySelector('#import-file'); const dt=new DataTransfer(); dt.items.add(new File([" + JSON.stringify(text) + "], " + JSON.stringify(filename) + ", {type:'application/json'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()";
    await evaluate(expression);
  }
  async function assertKhidmaImportRejected(text, filename, label) {
    const before = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
    const messageBefore = await evaluate("document.querySelector('#status')?.textContent");
    await uploadKhidmaArchive(text, filename);
    const changedStatus = "document.querySelector('#status')?.dataset.kind === 'error' && document.querySelector('#status')?.textContent !== " + JSON.stringify(messageBefore);
    await waitFor(changedStatus, label);
    assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), before, label + " must preserve the current stored state");
    console.log("PASS " + label + " rejects the import without overwriting current data");
  }

  await cdp.send('Page.navigate', { url: web.url }, session);
  await waitFor("document.readyState === 'complete' && document.querySelector('#status')?.textContent.includes('Local record store ready')", 'app boot');
  console.log('PASS browser boot and local store initialization');

  await evaluate("(() => { document.querySelector('#title').value='E2E repair request'; document.querySelector('#notes').value='Confirm replacement part'; document.querySelector('#record-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('from-everything-to-apps.record-vault') || '{}').records?.some(r => r.title === 'E2E repair request')", 'record persisted');
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('.record-card h3')?.textContent === 'E2E repair request'", 'record reload');
  console.log('PASS create and reload persistence');

  await evaluate("(() => { const card=[...document.querySelectorAll('.record-card')].find(el=>el.querySelector('h3')?.textContent==='E2E repair request'); card.querySelector('button').click(); document.querySelector('#title').value='E2E repair request updated'; document.querySelector('#notes').value='Updated note persists'; document.querySelector('#record-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('from-everything-to-apps.record-vault') || '{}').records?.some(r => r.title === 'E2E repair request updated' && r.notes === 'Updated note persists')", 'updated record persisted');
  console.log('PASS edit persistence');

  await evaluate("document.querySelector('#export').click(); true");
  const archivePath = await until(async () => {
    const names = await readdir(downloads);
    const completed = names.filter((name) => name.endsWith('.json'));
    if (!completed.length || names.some((name) => name.endsWith('.crdownload'))) return null;
    return path.join(downloads, completed[0]);
  }, 'archive download');
  const archiveText = await readFile(archivePath, 'utf8');
  const archive = JSON.parse(archiveText);
  assert.equal(archive.appId, 'record-vault');
  assert.equal(archive.data.records[0].title, 'E2E repair request updated');
  console.log('PASS archive export');

  await evaluate("document.querySelector('#clear').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('from-everything-to-apps.record-vault') || '{}').records?.length === 0", 'clear records');
  const fileEventExpression = "(async () => { const input=document.querySelector('#import-file'); const dt=new DataTransfer(); dt.items.add(new File([" + JSON.stringify(archiveText) + "], 'valid-backup.json', {type:'application/json'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()";
  await evaluate(fileEventExpression);
  await waitFor("JSON.parse(localStorage.getItem('from-everything-to-apps.record-vault') || '{}').records?.some(r => r.title === 'E2E repair request updated')", 'archive import');
  console.log('PASS clear and valid archive restore');

  const tampered = JSON.stringify({ ...archive, data: { ...archive.data, records: archive.data.records.map((record) => ({ ...record, title: 'Tampered record' })) } });
  const before = await evaluate("localStorage.getItem('from-everything-to-apps.record-vault')");
  const invalidEventExpression = "(async () => { const input=document.querySelector('#import-file'); const dt=new DataTransfer(); dt.items.add(new File([" + JSON.stringify(tampered) + "], 'tampered-backup.json', {type:'application/json'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()";
  await evaluate(invalidEventExpression);
  await waitFor("document.querySelector('#status')?.textContent.includes('Import rejected')", 'tampered archive rejection');
  assert.equal(await evaluate("localStorage.getItem('from-everything-to-apps.record-vault')"), before);
  assert.equal(await evaluate("document.querySelector('.record-card h3')?.textContent"), 'E2E repair request updated');
  console.log('PASS tampered archive rejection without overwriting current records');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
  const dimensions = await evaluate("({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.ok(dimensions.scrollWidth <= dimensions.width, 'Mobile layout overflow: viewport ' + dimensions.width + ', document ' + dimensions.scrollWidth);
  console.log('PASS Archive Lab mobile layout at 390px has no horizontal overflow');

  // Exercise the first domain application through the same real browser session.
  const khidmaUrl = new URL('/apps/khidma-desk/', web.url).toString();
  await cdp.send('Page.navigate', { url: khidmaUrl }, session);
  await waitFor("document.readyState === 'complete' && document.querySelector('#status')?.dataset.ready === 'true'", 'Khidma Desk boot');
  const frenchDimensions = await evaluate("({lang:document.documentElement.lang,dir:document.documentElement.dir,width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.equal(frenchDimensions.lang, 'fr');
  assert.equal(frenchDimensions.dir, 'ltr');
  assert.ok(frenchDimensions.scrollWidth <= frenchDimensions.width, 'French mobile layout overflow: viewport ' + frenchDimensions.width + ', document ' + frenchDimensions.scrollWidth);
  console.log('PASS Khidma Desk boots locally with a non-overflowing French LTR layout');

  await evaluate("(() => { document.querySelector('#customer-name').value='Atelier Al Amal'; document.querySelector('#customer-phone').value='+213 555 123 456'; document.querySelector('#customer-address').value='Blida'; document.querySelector('#customer-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').customers?.some(c => c.name === 'Atelier Al Amal')", 'Khidma customer save');
  await evaluate("(() => { const select=document.querySelector('#job-customer'); select.value=select.options[1].value; document.querySelector('#job-title').value='Repair air conditioner'; document.querySelector('#job-description').value='Check replacement part'; document.querySelector('#job-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.title === 'Repair air conditioner' && j.quotedAmountDzd === null && j.status === 'requested')", 'Khidma job creation without estimate');
  await evaluate("(() => { document.querySelector('.job-card button[data-action=estimate]').click(); document.querySelector('#estimate-amount').value='12000'; document.querySelector('#estimate-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.title === 'Repair air conditioner' && j.quotedAmountDzd === 12000 && j.status === 'requested')", 'Khidma estimate added after job creation');
  await evaluate("(() => { const select=document.querySelector('.job-card select'); select.value='quoted'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.status === 'quoted')", 'Khidma quoted status');
  console.log('PASS customer/job creation and estimate entry after creation');

  await evaluate("(() => { const select=document.querySelector('.job-card select'); select.value='scheduled'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.status === 'scheduled')", 'Khidma status transition');
  await evaluate("(() => { document.querySelector('.job-card button[data-action=payment]').click(); document.querySelector('#payment-amount').value='3000'; document.querySelector('#payment-method').value='cash'; document.querySelector('#payment-reference').value='E2E receipt'; document.querySelector('#payment-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.payments?.length === 1 && j.payments[0].amountDzd === 3000)", 'Khidma manual payment record');
  await evaluate("(() => { document.querySelector('.job-card button[data-action=estimate]').click(); document.querySelector('#estimate-amount').value='15000'; document.querySelector('#estimate-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.quotedAmountDzd === 15000 && j.payments?.length === 1 && j.payments[0].amountDzd === 3000)", 'Khidma estimate update after deposit');
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('#status')?.dataset.ready === 'true'", 'Khidma reload');
  await waitFor("document.querySelector('.job-card h3')?.textContent === 'Repair air conditioner' && document.querySelector('.payment-entry') !== null && JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.quotedAmountDzd === 15000)", 'Khidma job, payment and updated estimate restore after reload');
  console.log('PASS status transition, payment, estimate update after deposit and reload persistence');

  await evaluate("document.querySelector('#export').click(); true");
  const khidmaStateBeforeExport = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
  const khidmaArchivePath = await until(async () => {
    const names = await readdir(downloads);
    const completed = names.filter((name) => name.startsWith('khidma-desk-') && name.endsWith('.json'));
    if (!completed.length || names.some((name) => name.endsWith('.crdownload'))) return null;
    return path.join(downloads, completed[0]);
  }, 'Khidma archive download');
  const khidmaArchiveText = await readFile(khidmaArchivePath, 'utf8');
  const khidmaArchive = JSON.parse(khidmaArchiveText);
  assert.equal(khidmaArchive.appId, 'khidma-desk');
  assert.equal(khidmaArchive.data.customers[0].name, 'Atelier Al Amal');
  assert.equal(khidmaArchive.data.jobs[0].payments[0].amountDzd, 3000);
  await evaluate("document.querySelector('#clear').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').customers?.length === 0 && JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.length === 0", 'Khidma clear');
  await uploadKhidmaArchive(khidmaArchiveText, 'khidma-backup.json');
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.some(j => j.title === 'Repair air conditioner' && j.payments?.length === 1)", 'Khidma restore');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), khidmaStateBeforeExport, 'All customer, job, status and payment fields must round-trip without change.');
  console.log('PASS Khidma export, clear and exact full-state restore');

  const invalidKhidmaArchive = JSON.stringify({ ...khidmaArchive, data: { ...khidmaArchive.data, jobs: khidmaArchive.data.jobs.map((job) => ({ ...job, title: 'Tampered job' })) } });
  const khidmaStateBeforeInvalid = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
  await uploadKhidmaArchive(invalidKhidmaArchive, 'invalid-khidma-backup.json');
  await waitFor("document.querySelector('#status')?.dataset.kind === 'error'", 'Khidma invalid archive rejection');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), khidmaStateBeforeInvalid);
  assert.equal(await evaluate("document.querySelector('.job-card h3')?.textContent"), 'Repair air conditioner');
  console.log('PASS Khidma tampered backup rejection preserves customer, job and payment');

  const rejectionFixtures = await evaluate("(async () => { const { createArchive } = await import('/packages/portable-archive/src/index.js'); const current = JSON.parse(localStorage.getItem('khidma-desk.state.v1')); const wrongApp = await createArchive({ appId: 'another-app', schemaVersion: 1, data: current }); const futureSchema = await createArchive({ appId: 'khidma-desk', schemaVersion: 99, data: current }); const invalidDomain = await createArchive({ appId: 'khidma-desk', schemaVersion: 1, data: { schemaVersion: 1, customers: [], jobs: [{}] } }); return { wrongApp: JSON.stringify(wrongApp), futureSchema: JSON.stringify(futureSchema), invalidDomain: JSON.stringify(invalidDomain) }; })()");
  await assertKhidmaImportRejected(rejectionFixtures.wrongApp, 'wrong-app-backup.json', 'wrong-app archive');
  await assertKhidmaImportRejected(rejectionFixtures.futureSchema, 'future-schema-backup.json', 'future-schema archive');
  await assertKhidmaImportRejected(rejectionFixtures.invalidDomain, 'invalid-domain-backup.json', 'domain-invalid archive');

  const stateBeforeOversize = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
  const statusBeforeOversize = await evaluate("document.querySelector('#status')?.textContent");
  await evaluate("(() => { const input=document.querySelector('#import-file'); const dt=new DataTransfer(); dt.items.add(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversize-backup.json', {type:'application/json'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("document.querySelector('#status')?.dataset.kind === 'error' && document.querySelector('#status')?.textContent !== " + JSON.stringify(statusBeforeOversize), 'oversized archive rejection');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), stateBeforeOversize, 'An oversized import must preserve current data.');
  console.log('PASS oversized archive rejected before parsing and preserves current data');

  const stateBeforeWriteFailure = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
  await evaluate("(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'khidma-desk.state.v1') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError'); return original.call(this, key, value); }; document.querySelector('#customer-name').value = 'Write failure sentinel'; document.querySelector('#customer-form').requestSubmit(); Storage.prototype.setItem = original; return true; })()");
  await waitFor("document.querySelector('#status')?.dataset.kind === 'error' && document.querySelector('#status')?.textContent.includes('Enregistrement impossible')", 'localStorage write failure handling');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), stateBeforeWriteFailure, 'A failed localStorage write must preserve the prior persisted state.');
  assert.equal(await evaluate("[...document.querySelectorAll('.customer-card')].some(card => card.textContent.includes('Write failure sentinel'))"), false, 'A failed localStorage write must not advance the visible customer list.');
  console.log('PASS simulated localStorage quota failure preserves persisted and visible state');

  await evaluate("(() => { const originalText = File.prototype.text; File.prototype.text = function() { const pending = originalText.call(this); const key = 'khidma-desk.state.v1'; const changed = JSON.parse(Storage.prototype.getItem.call(localStorage, key)); const now = new Date().toISOString(); changed.customers.push({ id: 'concurrent-external-update', name: 'Concurrent external update', phone: '', address: '', notes: '', createdAt: now, updatedAt: now }); Storage.prototype.setItem.call(localStorage, key, JSON.stringify(changed)); return pending; }; const input = document.querySelector('#import-file'); const dt = new DataTransfer(); dt.items.add(new File([" + JSON.stringify(khidmaArchiveText) + "], 'concurrent-restore.json', {type:'application/json'})); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles:true})); File.prototype.text = originalText; return true; })()");
  await waitFor("document.querySelector('#status')?.dataset.kind === 'error' && document.querySelector('#status')?.textContent.includes('Les données ont changé ailleurs')", 'concurrent change during asynchronous import');
  const concurrentStored = await evaluate("localStorage.getItem('khidma-desk.state.v1')");
  assert.ok(JSON.parse(concurrentStored).customers.some((customer) => customer.name === 'Concurrent external update'), 'The newer externally stored customer must not be overwritten by the import.');
  assert.equal(await evaluate("[...document.querySelectorAll('.customer-card')].some(card => card.textContent.includes('Concurrent external update'))"), false, 'The stale in-memory view must not silently claim it includes the external update.');
  console.log('PASS concurrent storage change during asynchronous import is detected without overwriting newer stored data');
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('#status')?.dataset.ready === 'true'", 'Khidma reload after external storage update');
  await waitFor("[...document.querySelectorAll('.customer-card')].some(card => card.textContent.includes('Concurrent external update'))", 'fresh page loads newer external state');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), concurrentStored, 'Reload should load the validated externally stored state.');
  console.log('PASS reload reconciles the UI with the newer stored state after a detected conflict');

  const origin = new URL(web.url).origin;
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('#status')?.dataset.ready === 'true'", 'Khidma boot after clearing all origin storage');
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').customers?.length === 0 && JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.length === 0", 'Khidma empty state after origin data deletion');
  const emptyAfterOriginClear = await evaluate("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}')");
  assert.equal(emptyAfterOriginClear.customers.length, 0);
  assert.equal(emptyAfterOriginClear.jobs.length, 0);
  await uploadKhidmaArchive(khidmaArchiveText, 'recovery-after-origin-wipe.json');
  await waitFor("localStorage.getItem('khidma-desk.state.v1') === " + JSON.stringify(khidmaStateBeforeExport), 'restore from downloaded backup after clearing browser origin storage');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), khidmaStateBeforeExport, 'The backup must restore the complete prior dataset after origin storage is cleared.');
  console.log('PASS downloaded external backup restores full state after all origin storage is cleared');

  await evaluate("(() => { const select=document.querySelector('#language-select'); select.value='ar'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'", 'Arabic RTL locale');
  const arabicDimensions = await evaluate("({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,dir:document.documentElement.dir})");
  assert.equal(arabicDimensions.dir, 'rtl');
  assert.ok(arabicDimensions.scrollWidth <= arabicDimensions.width, 'Arabic mobile layout overflow: viewport ' + arabicDimensions.width + ', document ' + arabicDimensions.scrollWidth);
  console.log('PASS Arabic RTL rendering has no horizontal overflow at 390px');
  console.log('Browser acceptance passed for Archive Lab and Khidma Desk workflows.');
} catch (error) {
  console.error(error);
  if (browserErrors.length) console.error('Chrome stderr: ' + browserErrors.join('').slice(-4000));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill('SIGTERM');
    await Promise.race([exited, wait(4000)]);
    if (browser.exitCode === null) {
      const killed = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill('SIGKILL');
      await Promise.race([killed, wait(2000)]);
    }
  }
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
