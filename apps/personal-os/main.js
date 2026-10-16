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

function renderOverview() {
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

const viewTitles = { overview: 'Overview', apps: 'My apps', integrations: 'Integrations', architecture: 'System map' };
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
    history.replaceState(null, '', '#' + view);
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
  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.nav)));
  $('#global-search').addEventListener('input', (event) => applySearch(event.currentTarget.value));
  $('#global-search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.currentTarget.value) {
      event.currentTarget.value = '';
      applySearch('');
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
}

async function loadRegistry() {
  const response = await fetch(new URL('./registry.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Registry request returned HTTP ' + response.status);
  const data = await response.json();
  if (data?.schemaVersion !== 1 || !Array.isArray(data.apps) || !Array.isArray(data.modules) || !Array.isArray(data.integrations)) {
    throw new Error('Registry shape or schema version is unsupported.');
  }
  for (const app of data.apps) {
    if (!app || typeof app.id !== 'string' || typeof app.name !== 'string' ||
      typeof app.href !== 'string' || !app.href.startsWith('/') || app.href.startsWith('//')) {
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
    renderAll();
    const requestedView = window.location.hash.slice(1) || 'overview';
    activateView(requestedView, false);
    if (!shortcutStorageHealthy) $('#add-shortcut').disabled = true;
  } catch (error) {
    registryError = error.message || 'Unknown registry error';
    announce('The app registry could not be loaded. Existing local shortcut data was not modified. ' + registryError, 'error');
    console.error('Personal OS registry failed validation.', error);
    activateView('overview', false);
  }
}

void boot();
