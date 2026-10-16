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
  for (const id of ['note-form', 'project-form', 'task-form', 'research-form', 'document-form', 'media-form']) {
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
    ? 'Current records are local to this browser. The archive includes notes, projects, tasks, research, documents and media projects.'
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
      metadata: { product: 'Personal OS Apps', scope: 'notes-projects-tasks-research-documents-media' },
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
    const accepted = window.confirm('Restore this verified backup and replace the current Notes, Work Board, Research, Documents and Media data? Export your current records first if you need to keep them.');
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
    if (action === 'document-edit') editDocument(id);
    if (action === 'document-download') downloadDocument(id);
    if (action === 'document-delete') {
      const item = getDocument(id);
      if (item && window.confirm('Delete document "' + item.title + '"?')) {
        const wasEditing = $('#document-id').value === id;
        if (writeState({ ...state, documents: state.documents.filter((record) => record.id !== id) }, { successMessage: 'Document deleted.' }) && wasEditing) resetDocumentForm();
      }
    }
    if (action === 'media-edit') editMediaProject(id);
    if (action === 'media-delete') {
      const item = getMediaProject(id);
      if (item && window.confirm('Delete media project "' + item.title + '"?')) {
        const wasEditing = $('#media-id').value === id;
        if (writeState({ ...state, media: state.media.filter((record) => record.id !== id) }, { successMessage: 'Media project deleted.' }) && wasEditing) resetMediaForm();
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
  const mediaSelect = event.target.closest('select[data-action="media-stage"]');
  if (mediaSelect) {
    const item = getMediaProject(mediaSelect.dataset.id);
    if (!item || !MEDIA_STAGES.includes(mediaSelect.value)) return;
    writeState({ ...state, media: state.media.map((record) => record.id === item.id ? { ...record, stage: mediaSelect.value, updatedAt: new Date().toISOString() } : record) },
      { successMessage: 'Media production stage updated.' });
  }
}


function getDocument(id) { return state.documents.find((item) => item.id === id); }
function getMediaProject(id) { return state.media.find((item) => item.id === id); }

function resetDocumentForm() {
  $('#document-form').reset();
  $('#document-id').value = '';
  $('#document-format').value = 'md';
  $('#document-form-title').textContent = 'New document';
  $('#document-cancel-edit').hidden = true;
  $('#document-size-hint').textContent = 'Maximum 50,000 characters per document.';
}

function editDocument(id) {
  const item = getDocument(id);
  if (!item) return;
  $('#document-id').value = item.id;
  $('#document-title').value = item.title;
  $('#document-format').value = item.format;
  $('#document-tags').value = item.tags.join(', ');
  $('#document-content').value = item.content;
  $('#document-form-title').textContent = 'Edit document';
  $('#document-cancel-edit').hidden = false;
  $('#document-size-hint').textContent = item.content.length + ' / 50,000 characters.';
  $('#document-title').focus();
  $('#document-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitDocument(event) {
  event.preventDefault();
  const title = $('#document-title').value.trim();
  const body = $('#document-content').value;
  if (!title || !body.trim()) {
    announce('Add a file name and some document content before saving.', 'error');
    return;
  }
  const now = new Date().toISOString();
  const old = getDocument($('#document-id').value);
  const item = {
    id: old?.id || newId(),
    title: title.replace(/\.(md|txt)$/i, ''),
    format: $('#document-format').value,
    content: body,
    tags: parseTags($('#document-tags').value),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  if (writeState({ ...state, documents: old ? state.documents.map((record) => record.id === old.id ? item : record) : [item, ...state.documents] },
    { successMessage: old ? 'Document updated.' : 'Document saved in Files & Documents.' })) resetDocumentForm();
}

function safeFilename(title) {
  const cleaned = String(title || 'document').normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return cleaned || 'document';
}

function downloadDocument(id) {
  const item = getDocument(id);
  if (!item) return;
  const blob = new Blob([item.content], { type: item.format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a', '', '');
  link.href = url;
  link.download = safeFilename(item.title) + '.' + item.format;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Downloaded ' + item.title + '.' + item.format + '.', 'success');
}

function renderDocuments() {
  const filter = $('#documents-search').value.trim().toLocaleLowerCase();
  const records = [...state.documents].sort(whenUpdated).filter((item) =>
    !filter || [item.title, item.content, ...item.tags].join(' ').toLocaleLowerCase().includes(filter));
  const host = $('#documents-list');
  host.replaceChildren();
  if (!records.length) host.append(emptyMessage(filter ? 'No documents match this search.' : 'No documents yet. Import a Markdown/text file or create one.'));
  for (const item of records) {
    const card = element('article', 'collection-card document-card');
    const header = element('div', 'collection-card-header');
    const heading = element('div', 'collection-title-wrap');
    heading.append(element('h3', '', item.title + '.' + item.format));
    heading.append(element('span', 'small-muted', item.content.length + ' characters · Updated ' + new Date(item.updatedAt).toLocaleDateString()));
    header.append(heading);
    const actions = element('div', 'card-actions');
    actions.append(button('Edit', 'document-edit', item.id));
    actions.append(button('Download', 'document-download', item.id));
    actions.append(button('Delete', 'document-delete', item.id, 'small-action danger-action'));
    header.append(actions);
    card.append(header, element('p', 'document-preview', item.content.slice(0, 260) + (item.content.length > 260 ? '…' : '')));
    if (item.tags.length) {
      const tags = element('div', 'tag-row');
      makeTags(tags, item.tags);
      card.append(tags);
    }
    host.append(card);
  }
  $('#documents-count').textContent = String(state.documents.length);
  $('#files-nav-count').textContent = String(state.documents.length);
}

async function loadTextFile(file) {
  if (!file) return;
  const lowerName = file.name.toLocaleLowerCase();
  const format = lowerName.endsWith('.md') ? 'md' : lowerName.endsWith('.txt') ? 'txt' : null;
  if (!format || file.size > 100_000) {
    announce('Import only .md or .txt files up to 100 KB. Current documents were not changed.', 'error');
    $('#document-import').value = '';
    return;
  }
  try {
    const text = await file.text();
    if (text.includes(String.fromCharCode(0))) throw new Error('Binary files are not supported.');
    if (text.length > 50000) throw new Error('The text file exceeds 50,000 characters. Split it into smaller documents before importing.');
    $('#document-id').value = '';
    $('#document-title').value = file.name.replace(/\.(md|txt)$/i, '').slice(0, 140);
    $('#document-format').value = format;
    $('#document-content').value = text;
    $('#document-tags').value = '';
    $('#document-form-title').textContent = 'Review imported document';
    $('#document-cancel-edit').hidden = true;
    $('#document-size-hint').textContent = text.length + ' characters loaded. Review and save to keep it in the library.';
    $('#document-import').value = '';
    $('#document-title').focus();
    announce('File loaded into the editor. It is not saved until you select Save document.', 'success');
  } catch (error) {
    announce('Document import failed: ' + (error.message || 'unknown error'), 'error');
    $('#document-import').value = '';
  }
}

function renderMedia() {
  const filter = $('#media-search').value.trim().toLocaleLowerCase();
  const records = [...state.media].sort(whenUpdated).filter((item) =>
    !filter || [item.title, item.brief, item.notes, item.format, item.stage, item.outputUrl || '', ...item.tags].join(' ').toLocaleLowerCase().includes(filter));
  const host = $('#media-list');
  host.replaceChildren();
  if (!records.length) host.append(emptyMessage(filter ? 'No media projects match this search.' : 'No media projects yet. Add a brief to begin.'));
  const stages = [
    ['brief', 'Brief'], ['script', 'Script'], ['assets', 'Assets'], ['edit', 'Editing'], ['review', 'Review'], ['done', 'Done'],
  ];
  const summary = $('#media-stage-summary');
  summary.replaceChildren();
  for (const [stage, label] of stages) {
    const count = state.media.filter((item) => item.stage === stage).length;
    summary.append(element('span', 'media-stage-pill stage-' + stage, label + ' ' + count));
  }
  for (const item of records) {
    const card = element('article', 'collection-card media-card');
    const header = element('div', 'collection-card-header');
    const heading = element('div', 'collection-title-wrap');
    heading.append(element('h3', '', item.title));
    heading.append(element('span', 'small-muted', item.format === 'short-video' ? 'Short video / Reel' : item.format === 'advertisement' ? 'Advertisement' : item.format === 'product-demo' ? 'Product demo' : item.format === 'presentation' ? 'Presentation' : item.format === 'audio' ? 'Audio / voice' : 'Other'));
    header.append(heading);
    const actions = element('div', 'card-actions');
    actions.append(button('Edit', 'media-edit', item.id));
    actions.append(button('Delete', 'media-delete', item.id, 'small-action danger-action'));
    header.append(actions);
    card.append(header, element('p', 'collection-body', item.brief));
    if (item.notes) {
      const next = element('div', 'media-next-action');
      next.append(element('strong', '', 'Next action'), element('p', '', item.notes));
      card.append(next);
    }
    if (item.outputUrl) card.append(externalLink(item.outputUrl, 'Open deliverable ↗'));
    if (item.tags.length) {
      const tags = element('div', 'tag-row');
      makeTags(tags, item.tags);
      card.append(tags);
    }
    const footer = element('div', 'research-card-footer');
    const label = element('label', 'inline-select-label', 'Stage');
    const select = element('select', 'inline-state-select');
    select.dataset.action = 'media-stage';
    select.dataset.id = item.id;
    select.setAttribute('aria-label', 'Production stage for ' + item.title);
    for (const [stage, name] of stages) select.add(new Option(name, stage));
    select.value = item.stage;
    label.append(select);
    footer.append(label, element('span', 'small-muted', 'Updated ' + new Date(item.updatedAt).toLocaleDateString()));
    card.append(footer);
    host.append(card);
  }
  $('#media-count').textContent = String(state.media.length);
  $('#media-nav-count').textContent = String(state.media.length);
}

function resetMediaForm() {
  $('#media-form').reset();
  $('#media-id').value = '';
  $('#media-format').value = 'short-video';
  $('#media-stage').value = 'brief';
  $('#media-form-title').textContent = 'New media project';
  $('#media-cancel-edit').hidden = true;
}

function editMediaProject(id) {
  const item = getMediaProject(id);
  if (!item) return;
  $('#media-id').value = item.id;
  $('#media-project-title').value = item.title;
  $('#media-format').value = item.format;
  $('#media-stage').value = item.stage;
  $('#media-brief').value = item.brief;
  $('#media-next-action').value = item.notes;
  $('#media-output-url').value = item.outputUrl || '';
  $('#media-tags').value = item.tags.join(', ');
  $('#media-form-title').textContent = 'Edit media project';
  $('#media-cancel-edit').hidden = false;
  $('#media-project-title').focus();
  $('#media-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitMediaProject(event) {
  event.preventDefault();
  const title = $('#media-project-title').value.trim();
  const brief = $('#media-brief').value.trim();
  const outputUrl = $('#media-output-url').value.trim();
  if (!title || !brief) return;
  if (!validSourceUrl(outputUrl)) {
    announce('Deliverable URL must use HTTP or HTTPS and must not contain embedded credentials.', 'error');
    $('#media-output-url').focus();
    return;
  }
  const now = new Date().toISOString();
  const old = getMediaProject($('#media-id').value);
  const item = {
    id: old?.id || newId(),
    title,
    format: $('#media-format').value,
    stage: $('#media-stage').value,
    brief,
    notes: $('#media-next-action').value.trim(),
    outputUrl: outputUrl || null,
    tags: parseTags($('#media-tags').value),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  if (writeState({ ...state, media: old ? state.media.map((record) => record.id === old.id ? item : record) : [item, ...state.media] },
    { successMessage: old ? 'Media project updated.' : 'Media project added to the production queue.' })) resetMediaForm();
}


export function getPersonalAppsSnapshot() {
  return {
    notes: state.notes.map(({ id, title, body, tags, pinned, updatedAt }) => ({ id, title, body, tags, pinned, updatedAt })),
    projects: state.projects.map(({ id, name, description, createdAt }) => ({ id, name, description, createdAt })),
    tasks: state.tasks.map(({ id, title, projectId, priority, dueDate, notes, status, updatedAt }) => ({ id, title, projectId, priority, dueDate, notes, status, updatedAt })),
    research: state.research.map(({ id, title, url, summary, tags, status, updatedAt }) => ({ id, title, url, summary, tags, status, updatedAt })),
    documents: state.documents.map(({ id, title, format, tags, updatedAt }) => ({ id, title, format, tags, updatedAt })),
    media: state.media.map(({ id, title, format, stage, notes, outputUrl, tags, updatedAt }) => ({ id, title, format, stage, notes, outputUrl, tags, updatedAt })),
    storageHealthy,
  };
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

  $('#document-form').addEventListener('submit', submitDocument);
  $('#document-reset').addEventListener('click', resetDocumentForm);
  $('#document-cancel-edit').addEventListener('click', resetDocumentForm);
  $('#documents-search').addEventListener('input', renderDocuments);
  $('#documents-list').addEventListener('click', handleCollectionAction);
  $('#document-import').addEventListener('change', (event) => { void loadTextFile(event.currentTarget.files?.[0]); });

  $('#media-form').addEventListener('submit', submitMediaProject);
  $('#media-reset').addEventListener('click', resetMediaForm);
  $('#media-cancel-edit').addEventListener('click', resetMediaForm);
  $('#media-search').addEventListener('input', renderMedia);
  $('#media-list').addEventListener('click', handleCollectionAction);
  $('#media-list').addEventListener('change', handleCollectionAction);

  $('#export-suite-backup').addEventListener('click', exportBackup);
  $('#import-suite-backup').addEventListener('change', (event) => { void importBackup(event.currentTarget.files?.[0]); });
  $('#clear-suite-data').addEventListener('click', clearSuiteData);
  $('#task-priority').value = 'normal';
  renderAllApps();
  updateSafetyUI();
  if (!storageHealthy) announce('Saved app data is invalid. Restore a valid backup or clear app data before continuing.', 'error');
}
