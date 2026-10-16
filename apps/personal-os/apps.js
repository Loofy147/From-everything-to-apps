import { createArchive, stringifyArchive, parseArchive } from '@from-everything-to-apps/portable-archive';

const STORE_KEY = 'personal-os.suite-data.v1';
const APP_ID = 'personal-os';
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STATUSES = ['todo', 'doing', 'done'];
const RESEARCH_STATUSES = ['to-review', 'reviewed', 'actionable'];
const DOCUMENT_FORMATS = ['md', 'txt'];
const MEDIA_FORMATS = ['short-video', 'advertisement', 'product-demo', 'presentation', 'audio', 'other'];
const MEDIA_STAGES = ['brief', 'script', 'assets', 'edit', 'review', 'done'];
const PRIORITIES = ['low', 'normal', 'high'];

const emptyState = () => ({ schemaVersion: 1, notes: [], projects: [], tasks: [], research: [], documents: [], media: [] });
let state = emptyState();
let storageHealthy = true;
let renderSearch = '';

function element(tag, className, value) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value !== undefined && value !== null) result.textContent = String(value);
  return result;
}

function button(label, action, id, className = 'small-action') {
  const result = element('button', className, label);
  result.type = 'button';
  result.dataset.action = action;
  if (id) result.dataset.id = id;
  return result;
}

function announce(message, kind = 'info') {
  const status = $('#global-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return 'item-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function parseTags(value) {
  return [...new Set(String(value || '').split(',').map((tag) => tag.trim().toLocaleLowerCase().slice(0, 32)).filter(Boolean))].slice(0, 12);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedString(value, max, required = false) {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
}

function validTags(value) {
  return Array.isArray(value) && value.length <= 12 &&
    value.every((tag) => boundedString(tag, 32, true)) &&
    new Set(value).size === value.length;
}

function validSourceUrl(value) {
  if (value === null || value === '') return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function requireUniqueIds(items, label) {
  if (items.length > 5000) throw new Error(label + ' exceeds the supported item limit.');
  const ids = items.map((item) => item.id);
  if (ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length) {
    throw new Error(label + ' contains an invalid or duplicate ID.');
  }
}

function validateState(candidate) {
  if (!isRecord(candidate) || candidate.schemaVersion !== 1) throw new Error('Unsupported Personal OS data schema.');
  for (const key of ['notes', 'projects', 'tasks', 'research', 'documents', 'media']) {
    if (!Array.isArray(candidate[key])) throw new Error('Personal OS data is missing the ' + key + ' collection.');
  }
  requireUniqueIds(candidate.notes, 'Notes');
  requireUniqueIds(candidate.projects, 'Projects');
  requireUniqueIds(candidate.tasks, 'Tasks');
  requireUniqueIds(candidate.research, 'Research library');
  requireUniqueIds(candidate.documents, 'Documents');
  requireUniqueIds(candidate.media, 'Media projects');

  const projectIds = new Set(candidate.projects.map((project) => project.id));
  for (const note of candidate.notes) {
    if (!isRecord(note) || !boundedString(note.title, 140, true) ||
      !boundedString(note.body, 30000, true) || !validTags(note.tags) ||
      typeof note.pinned !== 'boolean' || !validTimestamp(note.createdAt) ||
      !validTimestamp(note.updatedAt)) throw new Error('A note has invalid fields or timestamps.');
  }
  for (const project of candidate.projects) {
    if (!isRecord(project) || !boundedString(project.name, 100, true) ||
      !boundedString(project.description, 1000) || !validTimestamp(project.createdAt)) {
      throw new Error('A project has invalid fields.');
    }
  }
  for (const task of candidate.tasks) {
    if (!isRecord(task) || !boundedString(task.title, 180, true) ||
      ![null, ...projectIds].includes(task.projectId) ||
      !PRIORITIES.includes(task.priority) || !STATUSES.includes(task.status) ||
      !(task.dueDate === null || (typeof task.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))) ||
      !boundedString(task.notes, 4000) || !validTimestamp(task.createdAt) ||
      !validTimestamp(task.updatedAt)) throw new Error('A task has invalid fields or references a missing project.');
  }
  for (const item of candidate.research) {
    if (!isRecord(item) || !boundedString(item.title, 180, true) ||
      !(item.url === null || boundedString(item.url, 1000)) || !validSourceUrl(item.url) ||
      !RESEARCH_STATUSES.includes(item.status) || !validTags(item.tags) ||
      !boundedString(item.summary, 20000) || !validTimestamp(item.createdAt) ||
      !validTimestamp(item.updatedAt)) throw new Error('A research item has invalid fields or source URL.');
  }

  for (const document of candidate.documents) {
    if (!isRecord(document) || !boundedString(document.title, 140, true) ||
      !DOCUMENT_FORMATS.includes(document.format) || !boundedString(document.content, 50000, true) ||
      !validTags(document.tags) || !validTimestamp(document.createdAt) ||
      !validTimestamp(document.updatedAt)) throw new Error('A document has invalid fields or content.');
  }
  for (const item of candidate.media) {
    if (!isRecord(item) || !boundedString(item.title, 180, true) ||
      !MEDIA_FORMATS.includes(item.format) || !MEDIA_STAGES.includes(item.stage) ||
      !boundedString(item.brief, 12000, true) || !boundedString(item.notes, 4000) ||
      !(item.outputUrl === null || boundedString(item.outputUrl, 1000)) ||
      !validSourceUrl(item.outputUrl) || !validTags(item.tags) ||
      !validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt)) {
      throw new Error('A media project has invalid fields or output URL.');
    }
  }

  const serialized = JSON.stringify(candidate);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STORE_BYTES) {
    throw new Error('Personal OS data exceeds the 4 MiB local data limit.');
  }
  return JSON.parse(serialized);
}

function loadState() {
  try {
    const saved = window.localStorage.getItem(STORE_KEY);
    if (saved === null) {
      state = emptyState();
      return;
    }
    if (new TextEncoder().encode(saved).byteLength > MAX_STORE_BYTES) throw new Error('Stored data is larger than the supported limit.');
    state = validateState(JSON.parse(saved));
  } catch (error) {
    storageHealthy = false;
    state = emptyState();
    announce('Saved Notes, Work Board or Research data could not be safely loaded. New writes are blocked until you restore a valid backup or clear this app data. Existing stored bytes were left untouched.', 'error');
    console.error('Personal OS app data failed validation.', error);
  }
}

function writeState(candidate, { recovery = false, successMessage = 'Personal OS data saved.' } = {}) {
  if (!storageHealthy && !recovery) {
    announce('Writing is disabled while the existing data is in an invalid state. Restore a valid backup or clear app data first.', 'error');
    return false;
  }
  let validated;
  let serialized;
  try {
    validated = validateState(candidate);
    serialized = JSON.stringify(validated);
  } catch (error) {
    announce(error.message || 'The data failed validation and was not saved.', 'error');
    return false;
  }
  try {
    window.localStorage.setItem(STORE_KEY, serialized);
  } catch {
    announce('The browser could not persist this change. Visible and stored data were not advanced.', 'error');
    return false;
  }
  state = validated;
  storageHealthy = true;
  renderAllApps();
  updateSafetyUI();
  announce(successMessage, 'success');
  window.dispatchEvent(new Event('personal-os:datachange'));
  return true;
}

function updateSafetyUI() {
  for (const id of ['note-form', 'project-form', 'task-form', 'research-form']) {
    const form = $('#' + id);
    if (form) $$('button[type="submit"]', form).forEach((button) => { button.disabled = !storageHealthy; });
  }
  $('#clear-suite-data').disabled = false;
  $('#export-suite-backup').disabled = !storageHealthy;
}

function whenUpdated(a, b) {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function makeTags(host, tags) {
  for (const tag of tags) host.append(element('span', 'tag', tag));
}

function emptyMessage(message) {
  return element('p', 'empty-state', message);
}

function getNote(id) { return state.notes.find((item) => item.id === id); }
function getProject(id) { return state.projects.find((item) => item.id === id); }
function getTask(id) { return state.tasks.find((item) => item.id === id); }
function getResearch(id) { return state.research.find((item) => item.id === id); }

function resetNoteForm() {
  $('#note-form').reset();
  $('#note-id').value = '';
  $('#note-form-title').textContent = 'New note';
  $('#note-cancel-edit').hidden = true;
}

function renderNotes() {
  const filter = $('#notes-search').value.trim().toLocaleLowerCase();
  const sorted = [...state.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || whenUpdated(a, b));
  const filtered = sorted.filter((note) => !filter || [note.title, note.body, ...note.tags].join(' ').toLocaleLowerCase().includes(filter));
  const host = $('#notes-list');
  host.replaceChildren();
  if (!filtered.length) host.append(emptyMessage(filter ? 'No notes match this search.' : 'No notes yet. Add one to begin.'));
  for (const note of filtered) {
    const card = element('article', 'collection-card note-card' + (note.pinned ? ' is-pinned' : ''));
    const header = element('div', 'collection-card-header');
    const titleWrap = element('div', 'collection-title-wrap');
    titleWrap.append(element('h3', '', note.title));
    titleWrap.append(element('span', 'small-muted', (note.pinned ? 'Pinned · ' : '') + 'Updated ' + new Date(note.updatedAt).toLocaleDateString()));
    header.append(titleWrap);
    const actions = element('div', 'card-actions');
    actions.append(button('Edit', 'note-edit', note.id));
    actions.append(button(note.pinned ? 'Unpin' : 'Pin', 'note-pin', note.id));
    actions.append(button('Delete', 'note-delete', note.id, 'small-action danger-action'));
    header.append(actions);
    card.append(header);
    const body = element('p', 'collection-body', note.body);
    card.append(body);
    if (note.tags.length) {
      const tags = element('div', 'tag-row');
      makeTags(tags, note.tags);
      card.append(tags);
    }
    host.append(card);
  }
  $('#notes-count').textContent = String(state.notes.length);
  $('#notes-nav-count').textContent = String(state.notes.length);
}

function editNote(id) {
  const note = getNote(id);
  if (!note) return;
  $('#note-id').value = note.id;
  $('#note-title').value = note.title;
  $('#note-tags').value = note.tags.join(', ');
  $('#note-body').value = note.body;
  $('#note-pinned').checked = note.pinned;
  $('#note-form-title').textContent = 'Edit note';
  $('#note-cancel-edit').hidden = false;
  $('#note-title').focus();
  $('#note-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitNote(event) {
  event.preventDefault();
  const title = $('#note-title').value.trim();
  const body = $('#note-body').value.trim();
  if (!title || !body) return;
  const now = new Date().toISOString();
  const old = getNote($('#note-id').value);
  const note = {
    id: old?.id || newId(),
    title,
    body,
    tags: parseTags($('#note-tags').value),
    pinned: $('#note-pinned').checked,
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  const next = { ...state, notes: old ? state.notes.map((item) => item.id === old.id ? note : item) : [note, ...state.notes] };
  if (writeState(next, { successMessage: old ? 'Note updated.' : 'Note saved.' })) resetNoteForm();
}

function renderProjects() {
  const host = $('#project-list');
  host.replaceChildren();
  if (!state.projects.length) host.append(emptyMessage('No projects yet.'));
  for (const project of [...state.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    const related = state.tasks.filter((task) => task.projectId === project.id);
    const card = element('article', 'project-chip');
    const copy = element('div', '');
    copy.append(element('strong', '', project.name), element('small', '', related.length + (related.length === 1 ? ' task' : ' tasks')));
    if (project.description) copy.append(element('p', '', project.description));
    card.append(copy);
    const remove = button('×', 'project-delete', project.id, 'icon-delete');
    remove.setAttribute('aria-label', 'Delete project ' + project.name);
    remove.title = related.length ? 'Move or delete its tasks before removing this project' : 'Delete project';
    remove.disabled = related.length > 0;
    card.append(remove);
    host.append(card);
  }
  $('#projects-count').textContent = String(state.projects.length);
  const select = $('#task-project');
  const selected = select.value;
  select.replaceChildren(new Option('No project', ''));
  for (const project of [...state.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    select.add(new Option(project.name, project.id));
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function submitProject(event) {
  event.preventDefault();
  const name = $('#project-name').value.trim();
  if (!name) return;
  if (state.projects.some((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    announce('A project with that name already exists.', 'error');
    return;
  }
  const project = {
    id: newId(),
    name,
    description: $('#project-description').value.trim(),
    createdAt: new Date().toISOString(),
  };
  if (writeState({ ...state, projects: [...state.projects, project] }, { successMessage: 'Project created.' })) {
    $('#project-form').reset();
    $('#task-project').value = project.id;
  }
}

function resetTaskForm() {
  $('#task-form').reset();
  $('#task-id').value = '';
  $('#task-priority').value = 'normal';
  $('#task-form-title').textContent = 'Add a task';
  $('#task-cancel-edit').hidden = true;
}

function renderTaskCard(task) {
  const card = element('article', 'task-card');
  const top = element('div', 'task-card-top');
  top.append(element('span', 'priority-chip priority-' + task.priority, task.priority));
  if (task.dueDate) top.append(element('span', 'task-due', task.dueDate));
  card.append(top);
  card.append(element('h3', '', task.title));
  if (task.projectId) card.append(element('span', 'task-project', getProject(task.projectId)?.name || 'Unknown project'));
  if (task.notes) card.append(element('p', 'task-notes', task.notes));
  const actions = element('div', 'task-card-actions');
  actions.append(button('Edit', 'task-edit', task.id));
  actions.append(button(task.status === 'todo' ? 'Start' : task.status === 'doing' ? 'Complete' : 'Reopen', 'task-advance', task.id));
  actions.append(button('Delete', 'task-delete', task.id, 'small-action danger-action'));
  card.append(actions);
  return card;
}

function renderBoard() {
  for (const status of STATUSES) {
    const filtered = state.tasks.filter((task) => task.status === status).sort((a, b) => {
      const aDate = a.dueDate || '9999-12-31';
      const bDate = b.dueDate || '9999-12-31';
      return aDate.localeCompare(bDate) || whenUpdated(a, b);
    });
    const host = $('#' + status + '-tasks');
    host.replaceChildren();
    if (!filtered.length) host.append(element('p', 'column-empty', status === 'todo' ? 'No next actions.' : status === 'doing' ? 'Nothing in progress.' : 'Completed tasks appear here.'));
    filtered.forEach((task) => host.append(renderTaskCard(task)));
    $('#' + status + '-count').textContent = String(filtered.length);
  }
  $('#board-summary').textContent = state.tasks.length + (state.tasks.length === 1 ? ' task' : ' tasks');
  $('#tasks-nav-count').textContent = String(state.tasks.filter((task) => task.status !== 'done').length);
  $('#data-task-count').textContent = String(state.tasks.length);
}

function submitTask(event) {
  event.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) return;
  const now = new Date().toISOString();
  const old = getTask($('#task-id').value);
  const projectId = $('#task-project').value || null;
  if (projectId && !getProject(projectId)) {
    announce('Choose an existing project or no project.', 'error');
    return;
  }
  const task = {
    id: old?.id || newId(),
    title,
    projectId,
    priority: $('#task-priority').value,
    dueDate: $('#task-due').value || null,
    notes: $('#task-notes').value.trim(),
    status: old?.status || 'todo',
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  const next = { ...state, tasks: old ? state.tasks.map((item) => item.id === old.id ? task : item) : [task, ...state.tasks] };
  if (writeState(next, { successMessage: old ? 'Task updated.' : 'Task added to Next.' })) resetTaskForm();
}

function editTask(id) {
  const task = getTask(id);
  if (!task) return;
  $('#task-id').value = task.id;
  $('#task-title').value = task.title;
  $('#task-project').value = task.projectId || '';
  $('#task-priority').value = task.priority;
  $('#task-due').value = task.dueDate || '';
  $('#task-notes').value = task.notes;
  $('#task-form-title').textContent = 'Edit task';
  $('#task-cancel-edit').hidden = false;
  $('#task-title').focus();
  $('#task-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function advanceTask(id) {
  const task = getTask(id);
  if (!task) return;
  const status = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo';
  const nextTask = { ...task, status, updatedAt: new Date().toISOString() };
  writeState({ ...state, tasks: state.tasks.map((item) => item.id === id ? nextTask : item) },
    { successMessage: status === 'doing' ? 'Task moved to In progress.' : status === 'done' ? 'Task completed.' : 'Task reopened.' });
}

function renderResearch() {
  const search = $('#research-search').value.trim().toLocaleLowerCase();
  const status = $('#research-state-filter').value;
  const records = [...state.research].sort(whenUpdated).filter((item) =>
    (status === 'all' || item.status === status) &&
    (!search || [item.title, item.url || '', item.summary, ...item.tags].join(' ').toLocaleLowerCase().includes(search)));
  const host = $('#research-list');
  host.replaceChildren();
  if (!records.length) host.append(emptyMessage(search || status !== 'all' ? 'No research items match these filters.' : 'No research items yet.'));
  for (const item of records) {
    const card = element('article', 'collection-card research-card');
    const header = element('div', 'collection-card-header');
    const heading = element('div', 'collection-title-wrap');
    heading.append(element('h3', '', item.title));
    heading.append(element('span', 'status-badge research-state-' + item.status, item.status === 'to-review' ? 'To review' : item.status === 'reviewed' ? 'Reviewed' : 'Actionable'));
    header.append(heading);
    const actions = element('div', 'card-actions');
    actions.append(button('Edit', 'research-edit', item.id));
    actions.append(button('Delete', 'research-delete', item.id, 'small-action danger-action'));
    header.append(actions);
    card.append(header);
    if (item.url) card.append(externalLink(item.url, item.url));
    if (item.summary) card.append(element('p', 'collection-body', item.summary));
    if (item.tags.length) {
      const tags = element('div', 'tag-row');
      makeTags(tags, item.tags);
      card.append(tags);
    }
    const footer = element('div', 'research-card-footer');
    const label = element('label', 'inline-select-label', 'Review state');
    const select = element('select', 'inline-state-select');
    select.dataset.action = 'research-status';
    select.dataset.id = item.id;
    select.setAttribute('aria-label', 'Review state for ' + item.title);
    for (const option of [
      ['to-review', 'To review'], ['reviewed', 'Reviewed'], ['actionable', 'Actionable']
    ]) select.add(new Option(option[1], option[0]));
    select.value = item.status;
    label.append(select);
    footer.append(label, element('span', 'small-muted', 'Updated ' + new Date(item.updatedAt).toLocaleDateString()));
    card.append(footer);
    host.append(card);
  }
  $('#research-count').textContent = String(state.research.length);
  $('#research-nav-count').textContent = String(state.research.length);
  $('#data-research-count').textContent = String(state.research.length);
}

function externalLink(url, label) {
  const link = element('a', 'research-source', label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function resetResearchForm() {
  $('#research-form').reset();
  $('#research-id').value = '';
  $('#research-form-title').textContent = 'Save research';
  $('#research-cancel-edit').hidden = true;
}

function submitResearch(event) {
  event.preventDefault();
  const title = $('#research-title-input').value.trim();
  const source = $('#research-url').value.trim();
  if (!title) return;
  if (!validSourceUrl(source)) {
    announce('Use an HTTP or HTTPS source URL without embedded username or password.', 'error');
    $('#research-url').focus();
    return;
  }
  const now = new Date().toISOString();
  const old = getResearch($('#research-id').value);
  const item = {
    id: old?.id || newId(),
    title,
    url: source || null,
    status: $('#research-status').value,
    tags: parseTags($('#research-tags').value),
    summary: $('#research-summary').value.trim(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  const next = { ...state, research: old ? state.research.map((record) => record.id === old.id ? item : record) : [item, ...state.research] };
  if (writeState(next, { successMessage: old ? 'Research item updated.' : 'Research source saved.' })) resetResearchForm();
}

function editResearch(id) {
  const item = getResearch(id);
  if (!item) return;
  $('#research-id').value = item.id;
  $('#research-title-input').value = item.title;
  $('#research-url').value = item.url || '';
  $('#research-status').value = item.status;
  $('#research-tags').value = item.tags.join(', ');
  $('#research-summary').value = item.summary;
  $('#research-form-title').textContent = 'Edit research item';
  $('#research-cancel-edit').hidden = false;
  $('#research-title-input').focus();
  $('#research-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderData() {
  $('#data-note-count').textContent = String(state.notes.length);
  $('#data-task-count').textContent = String(state.tasks.length);
  $('#data-research-count').textContent = String(state.research.length);
  $('#data-project-count').textContent = String(state.projects.length);
  $('#data-document-count').textContent = String(state.documents.length);
  $('#data-media-count').textContent = String(state.media.length);
  $('#backup-file-status').textContent = storageHealthy
    ? 'Current records are local to this browser. The archive includes notes, projects, tasks and research.'
    : 'Data validation failed. Restore a valid Personal OS backup or clear app data to recover.';
  $('#export-suite-backup').disabled = !storageHealthy;
}

function renderAllApps() {
  renderNotes();
  renderProjects();
  renderBoard();
  renderResearch();
  renderDocuments();
  renderMedia();
  renderData();
  updateSafetyUI();
}

async function exportBackup() {
  if (!storageHealthy) {
    announce('Export is disabled because the current stored data failed validation. Restore a valid backup or clear app data first.', 'error');
    return;
  }
  try {
    const archive = await createArchive({
      appId: APP_ID,
      schemaVersion: 1,
      data: state,
      metadata: { product: 'Personal OS Apps', scope: 'notes-projects-tasks-research' },
      maxBytes: MAX_ARCHIVE_BYTES,
    });
    const serialized = await stringifyArchive(archive, { maxBytes: MAX_ARCHIVE_BYTES });
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = element('a', '', '');
    link.href = url;
    link.download = 'personal-os-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('#backup-file-status').textContent = 'Backup generated successfully. Keep it somewhere separate from this browser.';
    announce('Personal OS backup downloaded. SHA-256 provides integrity checking, not encryption or identity verification.', 'success');
  } catch (error) {
    announce('Backup export failed: ' + (error.message || 'unknown error'), 'error');
  }
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_ARCHIVE_BYTES) {
    announce('Backup file exceeds the 4 MiB limit; current data was not changed.', 'error');
    return;
  }
  try {
    const text = await file.text();
    const parsed = await parseArchive(text, {
      expectedAppId: APP_ID,
      targetSchemaVersion: 1,
      validateData: (data) => { validateState(data); return true; },
      maxBytes: MAX_ARCHIVE_BYTES,
    });
    const validated = validateState(parsed.data);
    const accepted = window.confirm('Restore this verified backup and replace the current Notes, Work Board and Research Library data? Export your current records first if you need to keep them.');
    if (!accepted) {
      announce('Restore cancelled. Current app data was not changed.');
      return;
    }
    if (writeState(validated, { recovery: true, successMessage: 'Backup restored. The archive format, digest, schema and records were validated.' })) {
      $('#import-suite-backup').value = '';
      $('#backup-file-status').textContent = 'Last restore: ' + new Date().toLocaleString() + '. Current records came from a verified archive.';
    }
  } catch (error) {
    announce('Backup rejected: ' + (error.message || 'unknown error') + ' Current app data was not changed.', 'error');
    $('#import-suite-backup').value = '';
  }
}

function clearSuiteData() {
  const confirmed = window.confirm('Permanently clear Notes, Projects, Tasks and Research items in this browser? Export a backup first if needed.');
  if (!confirmed) return;
  resetNoteForm();
  resetTaskForm();
  resetResearchForm();
  writeState(emptyState(), { recovery: true, successMessage: 'Personal OS app data cleared from this browser.' });
}

function handleCollectionAction(event) {
  const actionButton = event.target.closest('button[data-action]');
  if (actionButton) {
    const { action, id } = actionButton.dataset;
    if (action === 'note-edit') editNote(id);
    if (action === 'note-pin') {
      const note = getNote(id);
      if (note) writeState({ ...state, notes: state.notes.map((item) => item.id === id ? { ...item, pinned: !item.pinned, updatedAt: new Date().toISOString() } : item) },
        { successMessage: note.pinned ? 'Note unpinned.' : 'Note pinned.' });
    }
    if (action === 'note-delete') {
      const note = getNote(id);
      if (note && window.confirm('Delete note "' + note.title + '"?')) {
        const wasEditing = $('#note-id').value === id;
        if (writeState({ ...state, notes: state.notes.filter((item) => item.id !== id) }, { successMessage: 'Note deleted.' }) && wasEditing) resetNoteForm();
      }
    }
    if (action === 'project-delete') {
      const project = getProject(id);
      if (project && !state.tasks.some((task) => task.projectId === id) && window.confirm('Delete project "' + project.name + '"?')) {
        writeState({ ...state, projects: state.projects.filter((item) => item.id !== id) }, { successMessage: 'Project deleted.' });
      }
    }
    if (action === 'task-edit') editTask(id);
    if (action === 'task-advance') advanceTask(id);
    if (action === 'task-delete') {
      const task = getTask(id);
      if (task && window.confirm('Delete task "' + task.title + '"?')) {
        const wasEditing = $('#task-id').value === id;
        if (writeState({ ...state, tasks: state.tasks.filter((item) => item.id !== id) }, { successMessage: 'Task deleted.' }) && wasEditing) resetTaskForm();
      }
    }
    if (action === 'research-edit') editResearch(id);
    if (action === 'research-delete') {
      const item = getResearch(id);
      if (item && window.confirm('Delete research item "' + item.title + '"?')) {
        const wasEditing = $('#research-id').value === id;
        if (writeState({ ...state, research: state.research.filter((record) => record.id !== id) }, { successMessage: 'Research item deleted.' }) && wasEditing) resetResearchForm();
      }
    }
  }
  const statusSelect = event.target.closest('select[data-action="research-status"]');
  if (statusSelect) {
    const item = getResearch(statusSelect.dataset.id);
    if (!item || !RESEARCH_STATUSES.includes(statusSelect.value)) return;
    writeState({ ...state, research: state.research.map((record) => record.id === item.id ? { ...record, status: statusSelect.value, updatedAt: new Date().toISOString() } : record) },
      { successMessage: 'Research review state updated.' });
  }
}

export async function bootPersonalApps() {
  loadState();
  $('#note-form').addEventListener('submit', submitNote);
  $('#note-reset').addEventListener('click', resetNoteForm);
  $('#note-cancel-edit').addEventListener('click', resetNoteForm);
  $('#notes-search').addEventListener('input', renderNotes);
  $('#notes-list').addEventListener('click', handleCollectionAction);

  $('#project-form').addEventListener('submit', submitProject);
  $('#project-list').addEventListener('click', handleCollectionAction);
  $('#task-form').addEventListener('submit', submitTask);
  $('#task-reset').addEventListener('click', resetTaskForm);
  $('#task-cancel-edit').addEventListener('click', resetTaskForm);
  $('#task-form').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#task-id').value) resetTaskForm();
  });
  $('.task-board').addEventListener('click', handleCollectionAction);

  $('#research-form').addEventListener('submit', submitResearch);
  $('#research-reset').addEventListener('click', resetResearchForm);
  $('#research-cancel-edit').addEventListener('click', resetResearchForm);
  $('#research-search').addEventListener('input', renderResearch);
  $('#research-state-filter').addEventListener('change', renderResearch);
  $('#research-list').addEventListener('click', handleCollectionAction);
  $('#research-list').addEventListener('change', handleCollectionAction);

  $('#export-suite-backup').addEventListener('click', exportBackup);
  $('#import-suite-backup').addEventListener('change', (event) => { void importBackup(event.currentTarget.files?.[0]); });
  $('#clear-suite-data').addEventListener('click', clearSuiteData);
  $('#task-priority').value = 'normal';
  renderAllApps();
  updateSafetyUI();
  if (!storageHealthy) announce('Saved app data is invalid. Restore a valid backup or clear app data before continuing.', 'error');
}
