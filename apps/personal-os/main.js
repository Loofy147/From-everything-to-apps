import { bootPersonalApps, getPersonalAppsSnapshot } from './apps.js';

const SHORTCUTS_KEY = 'personal-os.shortcuts.v1';
const THEME_KEY = 'personal-os.theme.v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let registry = { schemaVersion: 1, apps: [], modules: [], integrations: [] };
let shortcuts = [];
let shortcutStorageHealthy = true;
let activeView = 'overview';
let appFilter = 'all';
let integrationFilter = 'all';
let globalQuery = '';
let registryError = '';

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined && value !== null) element.textContent = String(value);
  return element;
}

function externalAnchor(url, label, className) {
  const anchor = node('a', className, label);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function announce(message, kind = 'info') {
  const status = $('#global-status');
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username && !url.password && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function normalizeShortcut(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value.id)) return null;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60) return null;
  if (typeof value.url !== 'string' || value.url.length > 500 || !validHttpUrl(value.url)) return null;
  const categories = new Set(['Personal', 'Work', 'Creative', 'Research', 'Development']);
  const category = categories.has(value.category) ? value.category : 'Personal';
  return { id: value.id, name: value.name.trim(), url: value.url, category };
}

function readShortcuts() {
  try {
    const raw = window.localStorage.getItem(SHORTCUTS_KEY);
    if (raw === null) return [];
    if (raw.length > 150_000) throw new Error('Shortcut storage exceeds the supported size.');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Shortcut storage has an unsupported shape.');
    const normalized = parsed.map(normalizeShortcut);
    if (normalized.some((item) => item === null) || new Set(normalized.map((item) => item.id)).size !== normalized.length) {
      throw new Error('Shortcut storage contains invalid or duplicate entries.');
    }
    return normalized;
  } catch (error) {
    shortcutStorageHealthy = false;
    announce('Saved shortcuts could not be validated. Their stored data has not been overwritten; check this browser profile before adding or removing shortcuts.', 'error');
    console.warn('Personal OS shortcut state could not be loaded safely.', error);
    return [];
  }
}

function persistShortcuts(next) {
  if (!shortcutStorageHealthy) {
    announce('Shortcut storage is not in a safe state. Existing stored data was left untouched.', 'error');
    return false;
  }
  const serialized = JSON.stringify(next);
  if (serialized.length > 150_000) {
    announce('Shortcut list exceeds the supported storage size.', 'error');
    return false;
  }
  try {
    window.localStorage.setItem(SHORTCUTS_KEY, serialized);
  } catch (error) {
    announce('The browser could not save this shortcut. The current list was not changed.', 'error');
    return false;
  }
  shortcuts = next;
  renderAll();
  return true;
}

function safeTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = value;
  $('#theme-toggle').setAttribute('aria-label', value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  $('#theme-toggle').title = value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  try { window.localStorage.setItem(THEME_KEY, value); } catch {}
}

function searchable(value) {
  return [value.name, value.category, value.description, ...(value.tags || []), value.license, value.kind].filter(Boolean).join(' ').toLocaleLowerCase();
}

function matchesQuery(value) {
  return !globalQuery || searchable(value).includes(globalQuery);
}

function appStatusClass(status) {
  if (status === 'prototype') return 'state-prototype';
  if (status === 'usable' || status === 'ready') return 'state-usable';
  return 'state-planned';
}

function createAppCard(app, { removable = false, compact = false } = {}) {
  const card = node(removable ? 'article' : 'a', 'app-card' + (compact ? ' compact-card' : ''));
  if (!removable) card.href = app.href;
  else card.dataset.shortcutId = app.id;
  const top = node('div', 'app-card-top');
  const appIcon = node('div', 'app-icon theme-' + (app.theme || 'blue'), app.icon || app.name.slice(0, 1).toUpperCase());
  appIcon.setAttribute('aria-hidden', 'true');
  const titleWrap = node('div', 'app-title-wrap');
  titleWrap.append(node('h3', '', app.name), node('span', 'app-category', app.category || 'Personal'));
  top.append(appIcon, titleWrap);
  if (app.statusLabel) top.append(node('span', 'status-badge ' + appStatusClass(app.status), app.statusLabel));
  card.append(top);
  card.append(node('p', '', app.description || 'A personal shortcut.'));
  const foot = node('div', 'app-card-foot');
  foot.append(node('span', '', app.storage || (removable ? 'Browser shortcut' : 'Local-first app')));
  const open = externalAnchor(
    app.href,
    removable ? 'Open ↗' : 'Open app →',
    'app-open'
  );
  if (!removable) {
    open.removeAttribute('target');
    open.removeAttribute('rel');
    // The card itself is the launch link; keep its affordance as plain text.
    foot.append(node('span', 'app-open', 'Launch →'));
  } else {
    foot.append(open);
    const remove = node('button', 'remove-shortcut', 'Remove');
    remove.type = 'button';
    remove.dataset.action = 'delete-shortcut';
    remove.dataset.shortcutId = app.id;
    remove.setAttribute('aria-label', 'Remove shortcut ' + app.name);
    foot.append(remove);
  }
  card.append(foot);
  if (app.tags?.length) {
    const tags = node('div', 'tag-row');
    app.tags.slice(0, 3).forEach((tag) => tags.append(node('span', 'tag', tag)));
    card.append(tags);
  }
  if (!removable) card.setAttribute('aria-label', 'Open ' + app.name);
  return card;
}

function createModuleCard(module) {
  const card = node('article', 'module-card');
  const top = node('div', 'module-top');
  top.append(node('span', 'module-icon', module.icon), node('span', 'status-badge state-prototype', module.statusLabel));
  card.append(top, node('h3', '', module.name), node('p', '', module.role), node('small', '', module.evidence));
  return card;
}

function integrationKindLabel(item) {
  if (item.kind === 'workspace-tool') return 'Workspace tool';
  if (item.kind === 'source-available') return 'Source available';
  if (item.kind.includes('self-hosted')) return 'Self-hostable';
  if (item.kind.includes('open-source')) return 'Open source';
  return 'Reference option';
}

function integrationKindClass(item) {
  if (item.kind === 'workspace-tool') return 'workspace';
  if (item.kind === 'source-available') return 'restricted';
  return 'source';
}

function createIntegrationCard(item) {
  const card = node('article', 'integration-card');
  const head = node('div', 'integration-head');
  const symbol = node('span', 'integration-symbol', item.name.slice(0, 2).toUpperCase());
  symbol.setAttribute('aria-hidden', 'true');
  const heading = node('div', 'integration-heading');
  heading.append(node('h3', '', item.name), node('p', '', item.category));
  head.append(symbol, heading);
  card.append(head, node('p', '', item.summary));
  const meta = node('div', 'integration-meta');
  meta.append(node('span', 'integration-status ' + integrationKindClass(item), integrationKindLabel(item)));
  meta.append(node('span', 'license-label', item.license));
  card.append(meta);
  const advice = node('div', 'integration-advice');
  advice.textContent = item.recommendation;
  card.append(advice);
  const foot = node('div', 'integration-foot');
  let stateLabel = item.appConnected ? 'Connected in app' : item.workspaceAvailable ? 'Not connected to this app' : item.appIntegrationState || 'Not configured';
  foot.append(node('span', '', stateLabel));
  foot.append(externalAnchor(item.url, 'Open ↗', 'integration-link'));
  card.append(foot);
  if (item.repository) {
    const repositoryLinks = node('div', 'integration-foot integration-sources');
    repositoryLinks.append(node('span', '', item.licenseUrl ? 'Repository & license references' : 'Repository reference'));
    repositoryLinks.append(externalAnchor(item.licenseUrl || item.repository, item.licenseUrl ? 'License ↗' : 'Source ↗', 'integration-link'));
    card.append(repositoryLinks);
  }
  return card;
}

function renderBuiltInApps(host, apps, limit = Infinity) {
  host.replaceChildren();
  const filtered = apps.filter(matchesQuery).slice(0, limit);
  filtered.forEach((app) => host.append(createAppCard(app)));
  return filtered.length;
}

function renderAppView() {
  const host = $('#apps-grid');
  host.replaceChildren();
  const all = [
    ...registry.apps.map((item) => ({ ...item, kind: 'built-in' })),
    ...shortcuts.map((item) => ({ ...item, kind: 'shortcut', storage: 'This browser only', icon: item.name.slice(0, 1).toUpperCase(), theme: 'blue', status: 'ready', statusLabel: 'Personal link' }))
  ];
  const filtered = all.filter((item) => {
    if (appFilter === 'ready' && item.kind !== 'built-in') return false;
    if (appFilter === 'shortcuts' && item.kind !== 'shortcut') return false;
    return matchesQuery(item);
  });
  filtered.forEach((item) => {
    if (item.kind === 'shortcut') host.append(createAppCard(item, { removable: true }));
    else host.append(createAppCard(item));
  });
  $('#apps-result-count').textContent = filtered.length + (filtered.length === 1 ? ' item' : ' items');
  $('#apps-empty').hidden = filtered.length > 0;
  $('#app-nav-count').textContent = String(registry.apps.length + shortcuts.length);
  $('#metric-apps').textContent = String(registry.apps.length);
  $('#metric-shortcuts').textContent = String(shortcuts.length);
  $('#add-shortcut').disabled = !shortcutStorageHealthy;
  $('#add-shortcut').title = shortcutStorageHealthy ? 'Add a personal shortcut' : 'Existing shortcut storage must be inspected first';
}

function renderIntegrationView() {
  const host = $('#integrations-grid');
  host.replaceChildren();
  const filtered = registry.integrations.filter((item) => {
    if (integrationFilter === 'workspace-tool' && item.kind !== 'workspace-tool') return false;
    if (integrationFilter === 'open-source' && !item.kind.includes('open-source')) return false;
    if (integrationFilter === 'self-hosted' && !item.kind.includes('self-hosted')) return false;
    return matchesQuery(item);
  });
  filtered.forEach((item) => host.append(createIntegrationCard(item)));
  $('#integration-result-count').textContent = filtered.length + (filtered.length === 1 ? ' integration' : ' integrations');
  $('#integrations-empty').hidden = filtered.length > 0;
  $('#integration-nav-count').textContent = String(registry.integrations.length);
  $('#metric-integrations').textContent = String(registry.integrations.length);
}


function displayDate(value) {
  if (!value) return 'No due date';
  const normalized = value.length === 10 ? value + 'T12:00:00' : value;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderDashboardList(host, items, emptyText, view, getTitle, getMeta, getSelector) {
  host.replaceChildren();
  if (!items.length) {
    host.append(node('p', 'dashboard-empty', emptyText));
    return;
  }
  for (const item of items) {
    const entry = node('button', 'dashboard-row');
    entry.type = 'button';
    entry.append(
      node('span', 'dashboard-row-main', getTitle(item)),
      node('span', 'dashboard-row-meta', getMeta(item)),
      node('span', 'dashboard-row-arrow', '↗')
    );
    entry.addEventListener('click', () => {
      activateView(view);
      requestAnimationFrame(() => {
        const target = document.querySelector(getSelector(item));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      });
    });
    host.append(entry);
  }
}


function quickSearchEntries(query) {
  const q = query.toLocaleLowerCase();
  const entries = [];
  for (const app of registry.apps) {
    if (searchable(app).toLocaleLowerCase().includes(q)) {
      entries.push({ title: app.name, subtitle: app.category + ' · App', kind: 'app', view: app.href.startsWith('#') ? app.href.slice(1) : null, href: app.href, queryKey: app.name });
    }
  }
  for (const shortcut of shortcuts) {
    if (searchable(shortcut).includes(q)) entries.push({ title: shortcut.name, subtitle: shortcut.category + ' · Shortcut', kind: 'shortcut', href: shortcut.url });
  }
  for (const integration of registry.integrations) {
    if (searchable(integration).includes(q)) entries.push({ title: integration.name, subtitle: integration.category + ' · Integration', kind: 'integration', view: 'integrations', queryKey: integration.name });
  }
  for (const module of registry.modules) {
    if ([module.name, module.role, module.evidence].join(' ').toLocaleLowerCase().includes(q)) {
      entries.push({ title: module.name, subtitle: 'Shared capability', kind: 'module', view: 'architecture', queryKey: module.name });
    }
  }

  const data = getPersonalAppsSnapshot();
  const addRecords = (items, view, kind, getTitle, getSummary, getTarget) => {
    for (const item of items) {
      const text = [getTitle(item), getSummary(item), ...(item.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase();
      if (text.includes(q)) entries.push({ title: getTitle(item), subtitle: kind + ' · ' + getSummary(item), kind: 'record', view, target: getTarget(item), queryKey: getTitle(item) });
    }
  };
  addRecords(data.notes, 'notes', 'Note', (item) => item.title, (item) => item.pinned ? 'Pinned note' : 'Personal note', (item) => '#note-' + item.id);
  addRecords(data.tasks, 'board', 'Task', (item) => item.title, (item) => item.status === 'todo' ? 'Next action' : item.status === 'doing' ? 'In progress' : 'Completed task', (item) => '#task-' + item.id);
  addRecords(data.projects, 'board', 'Project', (item) => item.name, () => 'Workstream', (item) => '#project-' + item.id);
  addRecords(data.research, 'research', 'Research', (item) => item.title, (item) => item.status === 'to-review' ? 'To review' : item.status === 'reviewed' ? 'Reviewed' : 'Actionable', (item) => '#research-' + item.id);
  addRecords(data.documents, 'files', 'Document', (item) => item.title, (item) => item.format.toUpperCase() + ' document', (item) => '#document-' + item.id);
  addRecords(data.media, 'media', 'Media', (item) => item.title, (item) => item.stage + ' · creative brief', (item) => '#media-' + item.id);
  return entries.slice(0, 10);
}

function navigateQuickResult(result) {
  const input = $('#global-search');
  const host = $('#global-search-results');
  host.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  if (result.kind === 'shortcut') {
    window.location.assign(result.href);
    return;
  }
  if (result.kind === 'app' && !result.view) {
    window.location.assign(result.href);
    return;
  }
  if (result.kind === 'record') {
    activateView(result.view);
    globalQuery = '';
    input.value = '';
    renderAll();
    requestAnimationFrame(() => {
      const target = document.querySelector(result.target);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
    return;
  }
  activateView(result.view || 'overview');
  input.value = result.kind === 'integration' ? result.queryKey : '';
  applySearch(input.value);
  host.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.focus();
}

function renderQuickSearch() {
  const input = $('#global-search');
  const host = $('#global-search-results');
  const query = input.value.trim();
  if (!query) {
    host.replaceChildren();
    host.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    return;
  }
  const results = quickSearchEntries(query);
  host.replaceChildren();
  if (!results.length) {
    host.append(node('p', 'quick-search-empty', 'No matching apps or saved items.'));
  } else {
    results.forEach((result, index) => {
      const item = node('button', 'quick-search-result');
      item.type = 'button';
      item.id = 'quick-search-result-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.append(
        node('span', 'quick-search-kind', result.kind === 'record' ? result.subtitle.split(' · ')[0] : result.kind),
        node('span', 'quick-search-copy', result.title),
        node('span', 'quick-search-subtitle', result.subtitle)
      );
      item.addEventListener('click', () => navigateQuickResult(result));
      host.append(item);
    });
  }
  host.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
}

function renderPersonalDashboard() {
  const data = getPersonalAppsSnapshot();
  const current = new Date();
  const today = [current.getFullYear(), String(current.getMonth() + 1).padStart(2, '0'), String(current.getDate()).padStart(2, '0')].join('-');
  const openTasks = data.tasks.filter((task) => task.status !== 'done');
  const dueTasks = openTasks.filter((task) => task.dueDate && task.dueDate <= today);
  const reviewItems = data.research.filter((item) => item.status === 'to-review');
  const activeMedia = data.media.filter((item) => item.stage !== 'done');

  $('#dashboard-open-tasks').textContent = String(openTasks.length);
  $('#dashboard-due-tasks').textContent = String(dueTasks.length);
  $('#dashboard-review-count').textContent = String(reviewItems.length);
  $('#dashboard-media-active').textContent = String(activeMedia.length);
  $('#dashboard-storage-notice').hidden = data.storageHealthy;

  const nextTasks = [...openTasks].sort((a, b) => {
    const aDue = a.dueDate || '9999-12-31';
    const bDue = b.dueDate || '9999-12-31';
    return aDue.localeCompare(bDue) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }).slice(0, 5);
  renderDashboardList(
    $('#dashboard-next-list'), nextTasks, 'No open tasks. Add a next action to make progress visible.', 'board',
    (task) => task.title,
    (task) => [task.priority === 'high' ? 'High priority' : task.priority === 'low' ? 'Low priority' : 'Normal priority', task.dueDate ? displayDate(task.dueDate) : 'No due date'].join(' · '),
    (task) => '#task-' + task.id
  );
  const recentNotes = [...data.notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  renderDashboardList(
    $('#dashboard-notes-list'), recentNotes, 'No notes yet. Save a reusable idea or decision.', 'notes',
    (item) => item.title,
    (item) => (item.pinned ? 'Pinned · ' : '') + 'Updated ' + displayDate(item.updatedAt.slice(0, 10)),
    (item) => '#note-' + item.id
  );
  const researchQueue = [...reviewItems].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  renderDashboardList(
    $('#dashboard-research-list'), researchQueue, 'Research queue clear. Add a source when you investigate something.', 'research',
    (item) => item.title,
    (item) => item.url ? new URL(item.url).hostname : 'No source URL',
    (item) => '#research-' + item.id
  );
  const mediaQueue = [...activeMedia].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  renderDashboardList(
    $('#dashboard-media-list'), mediaQueue, 'No active creative projects. Add a brief when work starts.', 'media',
    (item) => item.title,
    (item) => item.stage.charAt(0).toUpperCase() + item.stage.slice(1),
    (item) => '#media-' + item.id
  );
}

function renderOverview() {
  renderPersonalDashboard();
  renderBuiltInApps($('#overview-app-grid'), registry.apps, 3);
  const host = $('#overview-module-grid');
  host.replaceChildren();
  registry.modules.forEach((module) => host.append(createModuleCard(module)));
  $('#metric-modules').textContent = String(registry.modules.length);
  $('#app-nav-count').textContent = String(registry.apps.length + shortcuts.length);
  $('#metric-apps').textContent = String(registry.apps.length);
  $('#metric-shortcuts').textContent = String(shortcuts.length);
  $('#integration-nav-count').textContent = String(registry.integrations.length);
  $('#metric-integrations').textContent = String(registry.integrations.length);
}

function renderAll() {
  renderOverview();
  renderAppView();
  renderIntegrationView();
}

const viewTitles = { overview: 'Overview', apps: 'My apps', integrations: 'Integrations', architecture: 'System map', notes: 'Notes & Knowledge', board: 'Work Board', research: 'Research Library', files: 'Files & Documents', media: 'Media Workbench', data: 'Backup & Data' };
function activateView(view, updateHash = true) {
  if (!Object.hasOwn(viewTitles, view)) view = 'overview';
  activeView = view;
  for (const [key] of Object.entries(viewTitles)) {
    $('#view-' + key).hidden = key !== view;
  }
  $$('[data-nav]').forEach((button) => {
    if (button.tagName.toLowerCase() !== 'button') return;
    if (!button.dataset.nav) return;
    if (button.dataset.nav === view && button.classList.contains('nav-item')) button.setAttribute('aria-current', 'page');
    else if (button.classList.contains('nav-item')) button.removeAttribute('aria-current');
  });
  $('#page-crumb').textContent = viewTitles[view];
  document.title = viewTitles[view] + ' — Personal OS';
  if (updateHash && window.location.hash !== '#' + view) {
    history.pushState({ view }, '', '#' + view);
  }
  globalQuery = $('#global-search').value.trim().toLocaleLowerCase();
  renderAll();
}

function applySearch(value) {
  globalQuery = value.trim().toLocaleLowerCase();
  renderAll();
}

function openShortcutDialog() {
  if (!shortcutStorageHealthy) {
    announce('Shortcut storage could not be validated, so adding is disabled to protect the existing data.', 'error');
    return;
  }
  const dialog = $('#shortcut-dialog');
  $('#shortcut-error').hidden = true;
  $('#shortcut-form').reset();
  dialog.showModal();
  $('#shortcut-name').focus();
}

function closeShortcutDialog() {
  const dialog = $('#shortcut-dialog');
  if (dialog.open) dialog.close();
}

function showFormError(message) {
  const error = $('#shortcut-error');
  error.textContent = message;
  error.hidden = false;
}

function saveShortcut(event) {
  event.preventDefault();
  if (!shortcutStorageHealthy) return;
  if (shortcuts.length >= 100) {
    showFormError('This local shortcut list has reached the 100-item limit.');
    return;
  }
  const name = $('#shortcut-name').value.trim();
  const urlText = $('#shortcut-url').value.trim();
  const parsedUrl = (() => {
    try { return new URL(urlText); } catch { return null; }
  })();
  if (!name || name.length > 60) {
    showFormError('Enter a name between 1 and 60 characters.');
    return;
  }
  if (urlText.length > 500 || !validHttpUrl(urlText) || !parsedUrl) {
    showFormError('Enter a valid HTTP or HTTPS URL without embedded username or password.');
    return;
  }
  const normalizedUrl = parsedUrl.href;
  if (shortcuts.some((item) => item.url === normalizedUrl)) {
    showFormError('That exact URL is already saved as a shortcut.');
    return;
  }
  let id;
  try {
    id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : 'shortcut-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  } catch {
    id = 'shortcut-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }
  const next = [...shortcuts, { id, name, url: normalizedUrl, category: $('#shortcut-category').value }];
  if (persistShortcuts(next)) {
    closeShortcutDialog();
    activateView('apps');
    announce('Personal shortcut saved in this browser.', 'success');
  }
}

function removeShortcut(id) {
  const item = shortcuts.find((shortcut) => shortcut.id === id);
  if (!item) return;
  const next = shortcuts.filter((shortcut) => shortcut.id !== id);
  if (persistShortcuts(next)) announce('Removed shortcut "' + item.name + '" from this browser.', 'success');
}

function bindEvents() {
  $('[data-nav]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.nav)));
  const quickCreateFocus = { notes: '#note-title', board: '#task-title', research: '#research-title-input', media: '#media-project-title' };
  $('[data-quick-create]').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.quickCreate;
    activateView(view);
    requestAnimationFrame(() => $(quickCreateFocus[view])?.focus());
  }));
  $('#global-search').addEventListener('input', (event) => { applySearch(event.currentTarget.value); renderQuickSearch(); });
  $('#global-search-results').addEventListener('keydown', (event) => {
    const options = $('.quick-search-result', $('#global-search-results'));
    const index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      options[Math.min(index + 1, options.length - 1)].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0) $('#global-search').focus();
      else options[index - 1].focus();
    } else if (event.key === 'Escape') {
      $('#global-search-results').hidden = true;
      $('#global-search').setAttribute('aria-expanded', 'false');
      $('#global-search').focus();
    }
  });
  $('#global-search').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !$('#global-search-results').hidden) {
      const first = $('#global-search-results .quick-search-result');
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Escape' && !$('#global-search-results').hidden) {
      $('#global-search-results').hidden = true;
      event.currentTarget.setAttribute('aria-expanded', 'false');
      event.currentTarget.focus();
    } else if (event.key === 'Escape' && event.currentTarget.value) {
      event.currentTarget.value = '';
      applySearch('');
      renderQuickSearch();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) &&
      !$('#shortcut-dialog').open) {
      event.preventDefault();
      $('#global-search').focus();
    }
  });
  $('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  window.addEventListener('personal-os:datachange', () => renderAll());
  $$('[data-app-filter]').forEach((button) => button.addEventListener('click', () => {
    appFilter = button.dataset.appFilter;
    $$('[data-app-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderAppView();
  }));
  $$('[data-integration-filter]').forEach((button) => button.addEventListener('click', () => {
    integrationFilter = button.dataset.integrationFilter;
    $$('[data-integration-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderIntegrationView();
  }));
  $('#add-shortcut').addEventListener('click', openShortcutDialog);
  $('#close-shortcut').addEventListener('click', closeShortcutDialog);
  $('#cancel-shortcut').addEventListener('click', closeShortcutDialog);
  $('#shortcut-form').addEventListener('submit', saveShortcut);
  $('#apps-grid').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="delete-shortcut"]');
    if (button) removeShortcut(button.dataset.shortcutId);
  });
  $('#shortcut-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeShortcutDialog();
  });
  window.addEventListener('hashchange', () => activateView(window.location.hash.slice(1), false));
  window.addEventListener('popstate', () => activateView(window.location.hash.slice(1) || 'overview', false));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-wrap')) {
      $('#global-search-results').hidden = true;
      $('#global-search').setAttribute('aria-expanded', 'false');
    }
  });
}

async function loadRegistry() {
  const response = await fetch(new URL('./registry.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Registry request returned HTTP ' + response.status);
  const data = await response.json();
  if (data?.schemaVersion !== 1 || !Array.isArray(data.apps) || !Array.isArray(data.modules) || !Array.isArray(data.integrations)) {
    throw new Error('Registry shape or schema version is unsupported.');
  }
  for (const app of data.apps) {
    const internalRoute = typeof app?.href === 'string' && /^#(notes|board|research|files|media|data)$/.test(app.href);
    const externalAppPath = typeof app?.href === 'string' && app.href.startsWith('/') && !app.href.startsWith('//');
    if (!app || typeof app.id !== 'string' || typeof app.name !== 'string' ||
      typeof app.href !== 'string' || (!externalAppPath && !internalRoute)) {
      throw new Error('The registry contains an invalid built-in app entry.');
    }
  }
  for (const integration of data.integrations) {
    if (!integration || typeof integration.name !== 'string' || typeof integration.url !== 'string' || !validHttpUrl(integration.url)) {
      throw new Error('The registry contains an invalid integration URL.');
    }
  }
  registry = data;
}

async function boot() {
  setTheme(safeTheme());
  shortcuts = readShortcuts();
  bindEvents();
  try {
    await loadRegistry();
    await bootPersonalApps();
    renderAll();
    const requestedView = window.location.hash.slice(1) || 'overview';
    activateView(requestedView, false);
    renderQuickSearch();
    if (!shortcutStorageHealthy) $('#add-shortcut').disabled = true;
  } catch (error) {
    registryError = error.message || 'Unknown registry error';
    announce('The app registry could not be loaded. Existing local shortcut data was not modified. ' + registryError, 'error');
    console.error('Personal OS registry failed validation.', error);
    activateView('overview', false);
  }
}

void boot();
