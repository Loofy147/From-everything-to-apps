import {
  RecordVault,
  RecordVaultError,
  createLocalStorageAdapter,
} from '@from-everything-to-apps/record-vault';

const byId = (id) => document.getElementById(id);
const form = byId('record-form');
const titleInput = byId('title');
const notesInput = byId('notes');
const idInput = byId('record-id');
const recordsHost = byId('records');
const status = byId('status');
const importInput = byId('import-file');
const formHeading = byId('form-heading');
const saveButton = byId('save-record');
const cancelEdit = byId('cancel-edit');
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
let vault;

function announce(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formHeading.textContent = 'Add a record';
  saveButton.textContent = 'Save record';
  cancelEdit.hidden = true;
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function beginEdit(record) {
  idInput.value = record.id;
  titleInput.value = record.title;
  notesInput.value = record.notes;
  formHeading.textContent = 'Edit record';
  saveButton.textContent = 'Save changes';
  cancelEdit.hidden = false;
  titleInput.focus();
}

function render() {
  const records = vault.listRecords();
  byId('record-count').textContent = String(records.length);
  recordsHost.replaceChildren();

  if (records.length === 0) {
    recordsHost.append(createTextElement('p', 'empty', 'No records yet. Add one to begin.'));
    return;
  }

  for (const record of records) {
    const article = document.createElement('article');
    article.className = 'record-card';
    const content = document.createElement('div');
    content.className = 'record-content';
    content.append(createTextElement('h3', '', record.title));
    if (record.notes) content.append(createTextElement('p', 'record-notes', record.notes));
    content.append(createTextElement('p', 'record-meta', `Updated ${new Date(record.updatedAt).toLocaleString()}`));

    const controls = document.createElement('div');
    controls.className = 'record-controls';
    const stateLabel = document.createElement('label');
    stateLabel.className = 'status-label';
    stateLabel.append(createTextElement('span', '', 'Status'));
    const stateSelect = document.createElement('select');
    stateSelect.setAttribute('aria-label', `Status for ${record.title}`);
    for (const [value, label] of [['open', 'Open'], ['in_progress', 'In progress'], ['done', 'Done']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = record.status === value;
      stateSelect.append(option);
    }
    stateSelect.addEventListener('change', () => {
      try {
        vault.updateRecord(record.id, { status: stateSelect.value });
        render();
        announce('Record status saved.');
      } catch (error) {
        announce(error.message, 'error');
        render();
      }
    });
    stateLabel.append(stateSelect);

    const edit = createTextElement('button', 'button small secondary', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => beginEdit(record));

    const remove = createTextElement('button', 'button small danger', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!window.confirm(`Delete “${record.title}”? This change is saved immediately.`)) return;
      try {
        vault.deleteRecord(record.id);
        if (idInput.value === record.id) resetForm();
        render();
        announce('Record deleted.');
      } catch (error) {
        announce(error.message, 'error');
      }
    });

    controls.append(stateLabel, edit, remove);
    article.append(content, controls);
    recordsHost.append(article);
  }
}

function failBoot(error) {
  byId('record-form').querySelectorAll('input, textarea, button').forEach((item) => { item.disabled = true; });
  byId('export').disabled = true;
  byId('import-file').disabled = true;
  byId('clear').disabled = true;
  announce(`Could not safely open local records: ${error.message} Existing stored data was not reset.`, 'error');
  recordsHost.replaceChildren(createTextElement('p', 'empty error-copy', 'The existing storage was not overwritten. Review or export it through a recovery tool before trying again.'));
}

try {
  vault = RecordVault.open({ storage: createLocalStorageAdapter(window.localStorage) });
  render();
  announce('Local record store ready. Changes are saved to this browser.');
} catch (error) {
  failBoot(error);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!vault) return;
  const recordId = idInput.value;
  try {
    if (recordId) {
      vault.updateRecord(recordId, { title: titleInput.value, notes: notesInput.value });
      announce('Record updated and saved.');
    } else {
      vault.createRecord({ title: titleInput.value, notes: notesInput.value });
      announce('Record created and saved.');
    }
    resetForm();
    render();
  } catch (error) {
    announce(`Record was not saved: ${error.message}`, 'error');
  }
});

cancelEdit.addEventListener('click', resetForm);

byId('export').addEventListener('click', async () => {
  if (!vault) return;
  try {
    const archive = await vault.exportArchive({ metadata: { exportedFrom: 'archive-lab' } });
    const content = JSON.stringify(archive, null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `record-vault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    announce('Archive exported. Keep it somewhere safe; it is not encrypted.');
  } catch (error) {
    announce(`Export failed: ${error.message}`, 'error');
  }
});

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!vault || !file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    announce('Import rejected: archive exceeds the 10 MiB limit.', 'error');
    return;
  }
  if (vault.listRecords().length > 0 && !window.confirm('Importing replaces the current record set. Export your current records first if you need a copy. Continue?')) {
    announce('Import cancelled; existing records were not changed.');
    return;
  }
  try {
    const result = await vault.importArchive(await file.text());
    resetForm();
    render();
    announce(result.changed ? `Archive imported. ${result.imported} record(s) restored.` : 'Archive validated; it matches the current records.');
  } catch (error) {
    const message = error instanceof RecordVaultError ? error.message : 'Archive import failed.';
    announce(`Import rejected. Existing records were not replaced. ${message}`, 'error');
  }
});

byId('clear').addEventListener('click', () => {
  if (!vault) return;
  if (!window.confirm('Delete all records from this browser? This does not delete exported archive files.')) return;
  try {
    const emptyArchivePromise = vault.exportArchive();
    // Clearing uses the same validated domain state and persistence boundary.
    const records = vault.listRecords();
    for (const record of records) vault.deleteRecord(record.id);
    resetForm();
    render();
    announce('All records cleared from this browser.');
    void emptyArchivePromise;
  } catch (error) {
    announce(`Could not clear records: ${error.message}`, 'error');
  }
});
