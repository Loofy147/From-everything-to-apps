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
    } else if (packet.method === 'Runtime.exceptionThrown' && packet.sessionId) {
      const exception = packet.params?.exceptionDetails;
      browserErrors.push('PAGE EXCEPTION: ' + (exception?.exception?.description || exception?.text || 'Unknown exception'));
    } else if (packet.method === 'Runtime.consoleAPICalled' && packet.sessionId && packet.params?.type === 'error') {
      const details = packet.params.args?.map((arg) => arg.value || arg.description || '').join(' ');
      browserErrors.push('PAGE CONSOLE ERROR: ' + details);
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

  const personalOsRoot = new URL('/', web.url).toString();
  await cdp.send('Page.navigate', { url: personalOsRoot }, session);
  await waitFor("location.pathname === '/apps/personal-os/' && document.querySelector('#overview-title')?.textContent.includes('One control center')", 'Personal OS root redirect and boot');
  await waitFor("document.querySelectorAll('#overview-app-grid .app-card').length === 3", 'Personal OS app registry');
  const shellMetrics = await evaluate("({title:document.title,apps:document.querySelectorAll('#overview-app-grid .app-card').length,modules:document.querySelectorAll('#overview-module-grid .module-card').length,integrations:Number(document.querySelector('#metric-integrations')?.textContent),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.equal(shellMetrics.apps, 3);
  assert.equal(shellMetrics.modules, 3);
  assert.ok(shellMetrics.integrations >= 15, 'Expected a useful integration and license catalog.');
  assert.ok(shellMetrics.scrollWidth <= shellMetrics.width, 'Personal OS desktop layout has horizontal overflow.');
  assert.equal(await evaluate("document.querySelector('#dashboard-open-tasks')?.textContent"), '0');
  assert.ok(await evaluate("document.querySelector('#dashboard-title')?.textContent.includes('Your day')"), 'Personal OS overview should open on the live workspace dashboard.');
  await evaluate("document.querySelector('[data-quick-create=notes]').click(); true");
  await waitFor("!document.querySelector('#view-notes')?.hidden && document.activeElement?.id === 'note-title'", 'dashboard quick-create opens the Notes editor');
  await evaluate("document.querySelector('[data-nav=overview]').click(); true");
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
  const mobileDashboard = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.ok(mobileDashboard.scrollWidth <= mobileDashboard.width, 'Personal OS mobile dashboard has horizontal overflow: viewport ' + mobileDashboard.width + ', document ' + mobileDashboard.scrollWidth);
  await cdp.send('Emulation.clearDeviceMetricsOverride', {}, session);
  console.log('PASS Personal OS root entry, live dashboard, quick-create actions, mobile layout, app registry and integration catalog render');

  await evaluate("document.querySelector('[data-nav=integrations]').click(); true");
  await waitFor("!document.querySelector('#view-integrations')?.hidden && document.querySelectorAll('#integrations-grid .integration-card').length >= 15", 'Personal OS integrations view');
  const workspaceConnectors = await evaluate("document.querySelectorAll('#integrations-grid .integration-status.workspace').length");
  assert.ok(workspaceConnectors >= 5, 'Workspace-access labels should be present for connector tools.');
  assert.ok(await evaluate("[...document.querySelectorAll('#integrations-grid .integration-foot span')].some(el => el.textContent.includes('Not connected to this app'))"), 'Workspace tool cards must state that the deployed app is not connected.');
  await evaluate("(() => { const search=document.querySelector('#global-search'); search.value='supabase'; search.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  await wait(250);
  const integrationSearchState = await evaluate("({query:document.querySelector('#global-search')?.value,visible:!document.querySelector('#view-integrations')?.hidden,count:document.querySelectorAll('#integrations-grid .integration-card').length,names:[...document.querySelectorAll('#integrations-grid .integration-card h3')].map(node=>node.textContent),resultCount:document.querySelector('#integration-result-count')?.textContent,filter:[...document.querySelectorAll('[data-integration-filter]')].find(node=>node.classList.contains('is-active'))?.dataset.integrationFilter,status:document.querySelector('#global-status')?.textContent})");
  assert.ok(integrationSearchState.count >= 1 && integrationSearchState.names.includes('Supabase'), 'Personal OS integration search should include Supabase: ' + JSON.stringify(integrationSearchState));
  assert.equal(integrationSearchState.names[0], 'Supabase', 'Direct-name matches should rank ahead of cross-reference matches: ' + JSON.stringify(integrationSearchState));
  await evaluate("(() => { const search=document.querySelector('#global-search'); search.value=''; search.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-nav=apps]').click(); return true; })()");
  await waitFor("!document.querySelector('#view-apps')?.hidden && document.querySelectorAll('#apps-grid > a.app-card').length === 8", 'Personal OS apps view');
  console.log('PASS integration filters/search distinguish workspace tools from app-side connections');

  await evaluate("document.querySelector('#add-shortcut').click(); true");
  await waitFor("document.querySelector('#shortcut-dialog')?.open === true", 'Personal OS add-shortcut dialog');
  await evaluate("(() => { document.querySelector('#shortcut-name').value='E2E Notebook Link'; document.querySelector('#shortcut-url').value='https://example.com/notes'; document.querySelector('#shortcut-category').value='Personal'; document.querySelector('#shortcut-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.shortcuts.v1') || '[]').some(item => item.name === 'E2E Notebook Link') && [...document.querySelectorAll('#apps-grid article.app-card')].some(card => card.textContent.includes('E2E Notebook Link'))", 'Personal OS shortcut write and render');
  const shortcutStateBeforeUnsafe = await evaluate("localStorage.getItem('personal-os.shortcuts.v1')");
  await evaluate("document.querySelector('#add-shortcut').click(); true");
  await evaluate("(() => { document.querySelector('#shortcut-name').value='Unsafe URL Test'; document.querySelector('#shortcut-url').value='javascript:alert(1)'; document.querySelector('#shortcut-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()");
  await waitFor("!document.querySelector('#shortcut-error')?.hidden && document.querySelector('#shortcut-error')?.textContent.includes('valid HTTP or HTTPS URL')", 'Personal OS unsafe shortcut URL rejection');
  assert.equal(await evaluate("localStorage.getItem('personal-os.shortcuts.v1')"), shortcutStateBeforeUnsafe, 'Unsafe shortcut input must not modify stored shortcuts.');
  await evaluate("document.querySelector('#cancel-shortcut').click(); true");
  await evaluate("document.querySelector('#theme-toggle').click(); true");
  const themeAfterToggle = await evaluate("document.documentElement.dataset.theme");
  assert.ok(themeAfterToggle === 'dark' || themeAfterToggle === 'light');
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('#view-apps') && !document.querySelector('#view-apps').hidden && [...document.querySelectorAll('#apps-grid article.app-card')].some(card => card.textContent.includes('E2E Notebook Link'))", 'Personal OS shortcut after reload');
  assert.equal(await evaluate("document.documentElement.dataset.theme"), themeAfterToggle, 'Theme preference should survive reload.');
  await evaluate("document.querySelector('#apps-grid article.app-card[data-shortcut-id] button[data-action=delete-shortcut]').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.shortcuts.v1') || '[]').length === 0 && ![...document.querySelectorAll('#apps-grid article.app-card')].some(card => card.textContent.includes('E2E Notebook Link'))", 'Personal OS shortcut removal');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
  const mobileShell = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.ok(mobileShell.scrollWidth <= mobileShell.width, 'Personal OS mobile layout has horizontal overflow: viewport ' + mobileShell.width + ', document ' + mobileShell.scrollWidth);
  await cdp.send('Emulation.clearDeviceMetricsOverride', {}, session);
  console.log('PASS Personal OS custom shortcut save/reload/remove, URL validation, theme persistence and 390px layout');

  await evaluate("document.querySelector('[data-nav=notes]').click(); true");
  await waitFor("!document.querySelector('#view-notes')?.hidden", 'Notes & Knowledge view');
  await evaluate("(() => { document.querySelector('#note-title').value='E2E product principle'; document.querySelector('#note-tags').value='product, decisions'; document.querySelector('#note-body').value='Keep each app small, testable and portable.'; document.querySelector('#note-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').notes?.length === 1 && document.querySelector('#notes-list .note-card h3')?.textContent === 'E2E product principle'", 'Personal OS note create and persistence');
  await evaluate("document.querySelector('#notes-list button[data-action=note-pin]').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').notes?.[0]?.pinned === true", 'Personal OS pin note');
  await evaluate("document.querySelector('[data-nav=overview]').click(); true");
  await evaluate("(() => { const input=document.querySelector('#global-search'); input.value='E2E product principle'; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  await waitFor("!document.querySelector('#global-search-results')?.hidden && [...document.querySelectorAll('#global-search-results .quick-search-result')].some(item => item.textContent.includes('E2E product principle'))", 'cross-app search finds a saved note');
  await evaluate("document.querySelector('#global-search-results .quick-search-result').click(); true");
  await waitFor("!document.querySelector('#view-notes')?.hidden && document.activeElement?.id === 'note-' + JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).notes[0].id", 'search result navigates to and focuses the saved note');
  await evaluate("document.querySelector('[data-nav=board]').click(); true");
  await waitFor("!document.querySelector('#view-board')?.hidden", 'browser history navigation source view');
  await evaluate("history.back(); true");
  await waitFor("location.hash === '#notes' && !document.querySelector('#view-notes')?.hidden", 'browser back returns to previous app view');
  console.log('PASS unified search opens the matching record and browser back restores the previous app view');

  await evaluate("document.querySelector('[data-nav=board]').click(); true");
  await waitFor("!document.querySelector('#view-board')?.hidden", 'Work Board view');
  await evaluate("(() => { document.querySelector('#project-name').value='E2E Personal OS'; document.querySelector('#project-description').value='Build and verify internal apps.'; document.querySelector('#project-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').projects?.length === 1 && document.querySelector('#project-list').textContent.includes('E2E Personal OS')", 'Work Board project create');
  await evaluate("(() => { const data=JSON.parse(localStorage.getItem('personal-os.suite-data.v1')); document.querySelector('#task-title').value='Verify app recovery'; document.querySelector('#task-project').value=data.projects[0].id; document.querySelector('#task-priority').value='high'; document.querySelector('#task-notes').value='Export, clear, restore and compare.'; document.querySelector('#task-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').tasks?.length === 1 && document.querySelector('#todo-tasks').textContent.includes('Verify app recovery')", 'Work Board task create');
  await evaluate("document.querySelector('#todo-tasks button[data-action=task-advance]').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').tasks?.[0]?.status === 'doing'", 'Work Board start task');
  await evaluate("document.querySelector('#doing-tasks button[data-action=task-advance]').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').tasks?.[0]?.status === 'done' && document.querySelector('#done-tasks').textContent.includes('Verify app recovery')", 'Work Board task completion');

  await evaluate("document.querySelector('[data-nav=research]').click(); true");
  await waitFor("!document.querySelector('#view-research')?.hidden", 'Research Library view');
  await evaluate("(() => { document.querySelector('#research-title-input').value='Research test source'; document.querySelector('#research-url').value='javascript:alert(1)'; document.querySelector('#research-summary').value='This URL must be rejected.'; document.querySelector('#research-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()");
  await waitFor("document.querySelector('#global-status')?.dataset.kind === 'error' && document.querySelector('#global-status')?.textContent.includes('HTTP or HTTPS')", 'Research Library unsafe URL rejection');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').research?.length"), 0, 'Unsafe source URL must not be persisted.');
  await evaluate("(() => { document.querySelector('#research-url').value='https://example.com/architecture'; document.querySelector('#research-status').value='actionable'; document.querySelector('#research-tags').value='architecture, evidence'; document.querySelector('#research-summary').value='Capture decisions with source links and explicit limitations.'; document.querySelector('#research-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').research?.length === 1 && document.querySelector('#research-list').textContent.includes('Research test source')", 'Research Library save and persistence');

  await evaluate("document.querySelector('[data-nav=files]').click(); true");
  await waitFor("!document.querySelector('#view-files')?.hidden", 'Files & Documents view');
  await evaluate("(() => { document.querySelector('#document-title').value='E2E Decision Brief'; document.querySelector('#document-format').value='md'; document.querySelector('#document-tags').value='decisions, product'; document.querySelector('#document-content').value='# Decision brief\\n\\nKeep the application modular and portable.'; document.querySelector('#document-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').documents?.length === 1 && document.querySelector('#documents-list').textContent.includes('E2E Decision Brief.md')", 'Files & Documents create and persistence');
  await evaluate("document.querySelector('#documents-list button[data-action=document-download]').click(); true");
  const documentName = await until(async () => {
    const files = await readdir(downloads);
    return files.find((name) => name === 'E2E-Decision-Brief.md' && !name.endsWith('.crdownload'));
  }, 'individual Markdown download', 15000);
  const downloadedDocument = await readFile(path.join(downloads, documentName), 'utf8');
  assert.ok(downloadedDocument.includes('Keep the application modular and portable.'), 'Downloaded Markdown should preserve document content.');
  console.log('PASS Files & Documents creates and exports a Markdown document');

  await evaluate("document.querySelector('[data-nav=media]').click(); true");
  await waitFor("!document.querySelector('#view-media')?.hidden", 'Media Workbench view');
  await evaluate("(() => { document.querySelector('#media-project-title').value='E2E Product Launch Reel'; document.querySelector('#media-format').value='short-video'; document.querySelector('#media-stage').value='brief'; document.querySelector('#media-brief').value='Audience: potential customers. Show the product workflow and close with a clear call to action.'; document.querySelector('#media-next-action').value='Create a 20-second storyboard and collect product screenshots.'; document.querySelector('#media-output-url').value='https://example.com/creative-brief'; document.querySelector('#media-tags').value='product, launch'; document.querySelector('#media-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').media?.length === 1 && document.querySelector('#media-list').textContent.includes('E2E Product Launch Reel')", 'Media Workbench create and persistence');
  await evaluate("(() => { const select=document.querySelector('#media-list select[data-action=media-stage]'); select.value='script'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').media?.[0]?.stage === 'script'", 'Media Workbench production stage update');
  console.log('PASS Media Workbench stores creative briefs, output links and production stages');

  await evaluate("document.querySelector('[data-nav=observations]').click(); true");
  await waitFor("!document.querySelector('#view-observations')?.hidden", 'Observations view');
  await evaluate("(() => { const task=JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks[0]; document.querySelector('#observation-title').value='E2E integration permission gap'; document.querySelector('#observation-kind').value='risk'; document.querySelector('#observation-severity').value='high'; document.querySelector('#observation-status').value='open'; document.querySelector('#observation-related-task').value=task.id; document.querySelector('#observation-source-url').value='https://example.com/security-review'; document.querySelector('#observation-tags').value='integration, security'; document.querySelector('#observation-details').value='The deployment adapter has not been connected to a protected secret store. Keep the task linked until a backend boundary is verified.'; document.querySelector('#observation-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').observations?.length === 1 && document.querySelector('#observations-list').textContent.includes('E2E integration permission gap')", 'observation create, link and persistence');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).observations[0].relatedTaskId"), await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks[0].id"), 'Observation should link to the related task.');

  await evaluate("document.querySelector('[data-nav=vault]').click(); true");
  await waitFor("!document.querySelector('#view-vault')?.hidden", 'credential inventory view');
  await evaluate("(() => { const task=JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks[0]; document.querySelector('#vault-label').value='E2E GitHub release automation'; document.querySelector('#vault-provider').value='GitHub'; document.querySelector('#vault-secret-name').value='GITHUB_RELEASE_TOKEN'; document.querySelector('#vault-purpose').value='Publish validated releases from trusted CI only.'; document.querySelector('#vault-storage-location').value='github-actions'; document.querySelector('#vault-scopes').value='contents:read, releases:write'; document.querySelector('#vault-rotation-date').value='2099-12-31'; document.querySelector('#vault-status').value='planned'; document.querySelector('#vault-related-task').value=task.id; document.querySelector('#vault-form').requestSubmit(); return true; })()");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').vaultEntries?.length === 1 && document.querySelector('#vault-list').textContent.includes('GITHUB_RELEASE_TOKEN')", 'credential reference metadata create and persistence');
  const vaultStateBeforeUnsafe = await evaluate("localStorage.getItem('personal-os.suite-data.v1')");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).vaultEntries[0].relatedTaskId"), await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks[0].id"), 'Credential metadata should link to the related task.');
  assert.equal(await evaluate("Object.keys(JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).vaultEntries[0]).some(key => ['value','token','secretValue'].includes(key))"), false, 'Credential inventory must not define a secret-value field.');
  await evaluate("(() => { document.querySelector('#vault-label').value='Unsafe value test'; document.querySelector('#vault-provider').value='GitHub'; document.querySelector('#vault-secret-name').value='token-value'; document.querySelector('#vault-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()");
  await waitFor("document.querySelector('#global-status')?.dataset.kind === 'error' && document.querySelector('#global-status')?.textContent.includes('uppercase environment-style name')", 'credential reference strict validation');
  assert.equal(await evaluate("localStorage.getItem('personal-os.suite-data.v1')"), vaultStateBeforeUnsafe, 'Invalid credential metadata must not modify stored state.');
  await evaluate("document.querySelector('#vault-list select[data-action=vault-status]').value='rotation-due'; document.querySelector('#vault-list select[data-action=vault-status]').dispatchEvent(new Event('change',{bubbles:true})); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).vaultEntries[0].status === 'rotation-due' && document.querySelector('#dashboard-rotation-due')?.textContent === '1'", 'credential rotation status and dashboard count');

  await evaluate("document.querySelector('[data-nav=overview]').click(); true");
  await evaluate("(() => { const input=document.querySelector('#global-search'); input.value='GITHUB_RELEASE_TOKEN'; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  await waitFor("!document.querySelector('#global-search-results')?.hidden && [...document.querySelectorAll('#global-search-results .quick-search-result')].some(item => item.textContent.includes('E2E GitHub release automation'))", 'global search finds credential reference');
  await evaluate("document.querySelector('#global-search-results .quick-search-result').click(); true");
  await waitFor("!document.querySelector('#view-vault')?.hidden && document.activeElement?.id === 'vault-entry-' + JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).vaultEntries[0].id", 'credential search navigates and focuses the reference');
  await evaluate("document.querySelector('#vault-list button[data-action=vault-open-task]').click(); true");
  await waitFor("!document.querySelector('#view-board')?.hidden && document.activeElement?.id === 'task-' + JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks[0].id", 'credential reference opens linked task');
  await evaluate("document.querySelector('#done-tasks button[data-action=task-delete]').click(); true");
  await waitFor("document.querySelector('#global-status')?.dataset.kind === 'error' && document.querySelector('#global-status')?.textContent.includes('linked to an observation or credential')", 'linked task deletion guard');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).tasks.length"), 1, 'A linked task must not be deleted while credential/observation references exist.');
  console.log('PASS observations, credential inventory, task links, search, rotation tracking and secret-value boundary');

  async function uploadPersonalOsBackup(text, filename) {
    const expression = "(async () => { const input=document.querySelector('#import-suite-backup'); const dt=new DataTransfer(); dt.items.add(new File([" + JSON.stringify(text) + "], " + JSON.stringify(filename) + ", {type:'application/json'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()";
    await evaluate(expression);
  }
  await evaluate("document.querySelector('[data-nav=data]').click(); true");
  await waitFor("!document.querySelector('#view-data')?.hidden", 'Backup & Data view');
  await evaluate("document.querySelector('#export-suite-backup').click(); true");
  const backupName = await until(async () => {
    const files = await readdir(downloads);
    return files.find((name) => name.startsWith('personal-os-backup-') && !name.endsWith('.crdownload'));
  }, 'Personal OS backup download', 15000);
  const backupText = await readFile(path.join(downloads, backupName), 'utf8');
  const personalOsArchive = JSON.parse(backupText);
  assert.equal(personalOsArchive.format, 'from-everything-to-apps/portable-archive');
  assert.equal(personalOsArchive.appId, 'personal-os');
  assert.equal(personalOsArchive.data.notes.length, 1);
  assert.equal(personalOsArchive.data.projects.length, 1);
  assert.equal(personalOsArchive.data.tasks.length, 1);
  assert.equal(personalOsArchive.data.research.length, 1);
  assert.equal(personalOsArchive.data.documents.length, 1);
  assert.equal(personalOsArchive.data.media.length, 1);
  assert.equal(personalOsArchive.data.observations.length, 1);
  assert.equal(personalOsArchive.data.vaultEntries.length, 1);
  assert.equal(JSON.stringify(personalOsArchive.data.vaultEntries).includes('token-value'), false);
  console.log('PASS Personal OS data export includes eight collections with credential metadata only');

  const beforeTamperedImport = await evaluate("localStorage.getItem('personal-os.suite-data.v1')");
  const tamperedArchive = JSON.parse(backupText);
  tamperedArchive.data.notes[0].title = 'TAMPERED TITLE';
  await uploadPersonalOsBackup(JSON.stringify(tamperedArchive), 'tampered-personal-os.json');
  await waitFor("document.querySelector('#global-status')?.dataset.kind === 'error' && document.querySelector('#global-status')?.textContent.includes('Backup rejected')", 'tampered Personal OS backup rejection');
  assert.equal(await evaluate("localStorage.getItem('personal-os.suite-data.v1')"), beforeTamperedImport, 'A tampered backup must not overwrite current Personal OS data.');
  console.log('PASS tampered Personal OS archive is rejected without overwriting data');

  const invalidDomainBackup = await evaluate("(async () => { const { createArchive } = await import('/packages/portable-archive/src/index.js'); const current = JSON.parse(localStorage.getItem('personal-os.suite-data.v1')); const invalid = { ...current, tasks: current.tasks.map(task => ({ ...task, projectId: 'missing-project' })) }; const archive = await createArchive({ appId: 'personal-os', schemaVersion: 1, data: invalid }); return JSON.stringify(archive); })()");
  await uploadPersonalOsBackup(invalidDomainBackup, 'invalid-domain-personal-os.json');
  await waitFor("document.querySelector('#global-status')?.dataset.kind === 'error' && document.querySelector('#global-status')?.textContent.includes('Backup rejected')", 'correctly checksummed but invalid Personal OS data rejection');
  assert.equal(await evaluate("localStorage.getItem('personal-os.suite-data.v1')"), beforeTamperedImport, 'A domain-invalid archive must preserve the current Personal OS dataset.');
  console.log('PASS valid-digest archive with invalid project references is rejected without data loss');

  await evaluate("document.querySelector('#clear-suite-data').click(); true");
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').notes?.length === 0 && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').tasks?.length === 0", 'Personal OS clear app data');
  await uploadPersonalOsBackup(backupText, 'personal-os-backup-verified.json');
  await waitFor("JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').notes?.length === 1 && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').projects?.length === 1 && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').tasks?.[0]?.status === 'done' && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').research?.length === 1 && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').documents?.length === 1 && JSON.parse(localStorage.getItem('personal-os.suite-data.v1') || '{}').media?.[0]?.stage === 'script'", 'Personal OS verified backup restoration', 15000);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).observations.length"), 1);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('personal-os.suite-data.v1')).vaultEntries.length"), 1);
  console.log('PASS Personal OS backup restores all eight data collections after clearing the suite data');

  // Keep the Archive Lab download assertion isolated from the Personal OS backup file.
  await rm(path.join(downloads, backupName), { force: true });
  await cdp.send('Page.navigate', { url: web.url }, session);
  await waitFor("document.readyState === 'complete' && document.querySelector('#status')?.textContent.includes('Local record store ready')", 'Archive Lab boot');
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

  await evaluate("localStorage.clear(); sessionStorage.clear(); true");
  await cdp.send('Page.reload', {}, session);
  await waitFor("document.querySelector('#status')?.dataset.ready === 'true'", 'Khidma boot after clearing application localStorage');
  await waitFor("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').customers?.length === 0 && JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}').jobs?.length === 0", 'Khidma empty state after localStorage deletion');
  const emptyAfterLocalStorageClear = await evaluate("JSON.parse(localStorage.getItem('khidma-desk.state.v1') || '{}')");
  assert.equal(emptyAfterLocalStorageClear.customers.length, 0);
  assert.equal(emptyAfterLocalStorageClear.jobs.length, 0);
  await uploadKhidmaArchive(khidmaArchiveText, 'recovery-after-localstorage-wipe.json');
  await waitFor("localStorage.getItem('khidma-desk.state.v1') === " + JSON.stringify(khidmaStateBeforeExport), 'restore from downloaded backup after clearing application localStorage');
  assert.equal(await evaluate("localStorage.getItem('khidma-desk.state.v1')"), khidmaStateBeforeExport, 'The backup must restore the complete prior dataset after application localStorage is cleared.');
  console.log('PASS downloaded external backup restores full state after clearing all application localStorage');

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
