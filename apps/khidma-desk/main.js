import {
  createArchive,
  parseArchive,
  PortableArchiveError,
} from '@from-everything-to-apps/portable-archive';
import {
  addCustomer,
  addJob,
  canTransitionJob,
  createEmptyState,
  updateJobEstimate,
  KhidmaError,
  normalizeState,
  paymentTotal,
  recordPayment,
  transitionJob,
} from '@from-everything-to-apps/khidma-core';

const STORAGE_KEY = 'khidma-desk.state.v1';
const LANGUAGE_KEY = 'khidma-desk.language';
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const importInput = $('import-file');

const messages = {
  fr: {
    language: 'Langue', eyebrow: 'SERVICES · LOCAL-FIRST',
    heroTitle: 'Demandes clients, interventions et paiements au même endroit.',
    heroCopy: 'Un espace de travail ciblé pour les indépendants. Commencez par un client et une intervention, puis suivez son état et les paiements saisis manuellement.',
    privacyTitle: 'Prototype local',
    privacyCopy: 'Les données restent dans ce navigateur et ne sont pas chiffrées. Exportez une sauvegarde. Les paiements sont saisis manuellement et ne sont pas vérifiés par l’application ; ce produit ne fait ni comptabilité ni facture conforme.',
    export: 'Exporter la sauvegarde', import: 'Importer une sauvegarde', clear: 'Effacer les données locales',
    customersSummary: 'Clients', jobsSummary: 'Interventions ouvertes', paymentsSummary: 'Paiements enregistrés',
    customerEyebrow: 'CLIENT', customerHeading: 'Ajouter un client', customerName: 'Nom du client *',
    customerPhone: 'Téléphone (facultatif)', customerAddress: 'Adresse (facultatif)', customerNotes: 'Notes (facultatif)', saveCustomer: 'Enregistrer le client',
    jobEyebrow: 'INTERVENTION', jobHeading: 'Créer une intervention', jobCustomer: 'Client *', jobTitle: 'Objet de l’intervention *',
    jobDescription: 'Description (facultatif)', appointment: 'Rendez-vous (facultatif)', estimate: 'Montant estimé en DZD (facultatif)', createJob: 'Créer l’intervention',
    customersListEyebrow: 'CARNET CLIENTS', customers: 'Clients', jobsListEyebrow: 'INTERVENTIONS', jobs: 'Interventions',
    noCustomers: 'Aucun client pour le moment.', noJobs: 'Aucune intervention pour le moment.',
    customerFirst: 'Ajoutez d’abord un client', phonePlaceholder: '+213 …', titlePlaceholder: 'Réparation, installation, entretien…',
    updateEstimate: 'Définir / modifier l’estimation', estimateEyebrow: 'ESTIMATION', estimateDialogTitle: 'Définir ou modifier l’estimation', estimateAmountLabel: 'Montant estimé (DZD)', estimateWarning: 'Il s’agit d’une estimation, pas d’une facture ou d’un devis conforme.', saveEstimate: 'Enregistrer l’estimation',
    payment: 'Enregistrer un paiement', paymentEyebrow: 'SAISIE DE PAIEMENT', paymentAmount: 'Montant (DZD) *',
    paymentMethod: 'Mode de paiement *', paymentReference: 'Référence (facultatif)', paymentWarning: 'Saisie manuelle uniquement : aucun paiement n’est traité ni vérifié.',
    cash: 'Espèces', bank_transfer: 'Virement bancaire', cib: 'CIB', edahabia: 'Edahabia', other: 'Autre',
    cancel: 'Annuler', savePayment: 'Enregistrer le paiement', close: 'Fermer',
    limits: 'Limites du prototype et traitement des données',
    limitsCopy: 'Ce prototype utilise le localStorage du navigateur sans chiffrement. Conservez des sauvegardes séparées. L’effacement des données du site peut supprimer les dossiers. Aucune donnée n’est envoyée à un serveur. Les paiements sont déclaratifs et les estimations ne sont pas des documents légaux ou fiscaux. N’y saisissez pas de données sensibles ou irremplaçables.',
    footer: 'Khidma Desk v0.1 · Prototype local · Ne traite pas les paiements',
    ready: 'Espace local prêt. Les modifications sont enregistrées dans ce navigateur.',
    savedCustomer: 'Client enregistré.', savedJob: 'Intervention enregistrée.', savedPayment: 'Paiement enregistré comme note manuelle.',
    deleted: 'Les données locales ont été effacées.', exported: 'Sauvegarde exportée. Elle n’est pas chiffrée.',
    imported: 'Sauvegarde restaurée.', importSame: 'Cette sauvegarde correspond déjà aux données locales.',
    importRejected: 'Import refusé. Les données existantes n’ont pas été remplacées.',
    saveFailed: 'Enregistrement impossible. Les données en mémoire n’ont pas été avancées.', savedEstimate: 'Estimation enregistrée.',
    storageConflict: 'Les données ont changé ailleurs. Rechargez la page avant une nouvelle modification.',
    exportFailed: 'Export impossible.', bootFailed: 'Impossible d’ouvrir les données locales. Le contenu existant n’a pas été réinitialisé.',
    clearConfirm: 'Effacer tous les clients et interventions de ce navigateur ? Cette action ne supprime pas les sauvegardes exportées.',
    importConfirm: 'L’import remplace tous les clients et interventions locaux. Exportez d’abord une sauvegarde si nécessaire. Continuer ?',
    deleteNothing: 'Aucune donnée à effacer.', statusLabel: 'État', customerLabel: 'Client', appointmentLabel: 'Rendez-vous',
    estimated: 'Estimation', paid: 'Enregistré', remaining: 'Solde calculé', paymentsList: 'Paiements saisis',
    recordPayment: 'Ajouter un paiement', notSet: 'Non renseigné', noDescription: 'Aucune description.',
    requested: 'Demande reçue', quoted: 'Estimation donnée', scheduled: 'Planifiée', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée',
    jobStatus: 'État de l’intervention', paidAmount: 'Montant payé', amountRemaining: 'Reste estimé',
    clearTitle: 'Effacer les données', recordPaymentFor: 'Enregistrer un paiement pour ', customerCardPhone: 'Tél. : ', customerCardAddress: 'Adresse : ',
    paymentEntry: 'Paiement', malformed: 'Le fichier est invalide ou incompatible.', tooLarge: 'Sauvegarde trop volumineuse (limite 10 Mio).',
  },
  ar: {
    language: 'اللغة', eyebrow: 'الخدمات · العمل محلياً',
    heroTitle: 'طلبات الزبائن والأشغال وسجلات الدفع في مكان واحد.',
    heroCopy: 'مساحة عمل بسيطة لمقدّمي الخدمات المستقلين. سجّل زبوناً وعملاً، ثم تابع الحالة والمدفوعات التي تُدخل يدوياً.',
    privacyTitle: 'نسخة تجريبية محلية',
    privacyCopy: 'تبقى البيانات في هذا المتصفح وهي غير مشفّرة. صدّر نسخة احتياطية. تُسجّل المدفوعات يدوياً ولا يتحقق التطبيق منها؛ هذا التطبيق ليس نظام محاسبة ولا يصدر فواتير مطابقة قانونياً.',
    export: 'تصدير نسخة احتياطية', import: 'استيراد نسخة احتياطية', clear: 'مسح البيانات المحلية',
    customersSummary: 'الزبائن', jobsSummary: 'الأشغال المفتوحة', paymentsSummary: 'المدفوعات المسجّلة',
    customerEyebrow: 'زبون', customerHeading: 'إضافة زبون', customerName: 'اسم الزبون *',
    customerPhone: 'الهاتف (اختياري)', customerAddress: 'العنوان (اختياري)', customerNotes: 'ملاحظات (اختياري)', saveCustomer: 'حفظ الزبون',
    jobEyebrow: 'عمل / خدمة', jobHeading: 'إنشاء عمل', jobCustomer: 'الزبون *', jobTitle: 'عنوان العمل *',
    jobDescription: 'الوصف (اختياري)', appointment: 'موعد (اختياري)', estimate: 'المبلغ التقديري بالدينار (اختياري)', createJob: 'إنشاء العمل',
    customersListEyebrow: 'سجل الزبائن', customers: 'الزبائن', jobsListEyebrow: 'الأعمال', jobs: 'الأعمال',
    noCustomers: 'لا يوجد زبائن بعد.', noJobs: 'لا توجد أعمال بعد.',
    customerFirst: 'أضف زبوناً أولاً', phonePlaceholder: '+213 …', titlePlaceholder: 'إصلاح، تركيب، صيانة…',
    updateEstimate: 'تحديد / تعديل التقدير', estimateEyebrow: 'تقدير المبلغ', estimateDialogTitle: 'تحديد أو تعديل المبلغ التقديري', estimateAmountLabel: 'المبلغ التقديري (دج)', estimateWarning: 'هذا مبلغ تقديري وليس فاتورة رسمية أو عرض سعر مطابقاً للقانون.', saveEstimate: 'حفظ التقدير',
    payment: 'تسجيل دفعة', paymentEyebrow: 'تسجيل الدفع', paymentAmount: 'المبلغ (دج) *',
    paymentMethod: 'طريقة الدفع *', paymentReference: 'المرجع (اختياري)', paymentWarning: 'إدخال يدوي فقط: التطبيق لا يعالج الدفع ولا يتحقق منه.',
    cash: 'نقداً', bank_transfer: 'تحويل بنكي', cib: 'CIB', edahabia: 'الذهبية', other: 'أخرى',
    cancel: 'إلغاء', savePayment: 'حفظ سجل الدفع', close: 'إغلاق',
    limits: 'حدود النسخة التجريبية ومعالجة البيانات',
    limitsCopy: 'تستخدم هذه النسخة localStorage في المتصفح دون تشفير. احتفظ بنسخ احتياطية منفصلة. قد يؤدي مسح بيانات الموقع إلى فقدان السجلات. لا تُرسل البيانات إلى خادم. سجلات الدفع مدخلة من المستخدم وليست إثباتاً، والمبالغ التقديرية ليست وثائق قانونية أو ضريبية. لا تدخل بيانات حساسة أو لا يمكن تعويضها.',
    footer: 'خدمة Desk v0.1 · نسخة محلية تجريبية · لا تعالج المدفوعات',
    ready: 'المساحة المحلية جاهزة. تُحفظ التغييرات في هذا المتصفح.',
    savedCustomer: 'تم حفظ الزبون.', savedJob: 'تم حفظ العمل.', savedPayment: 'تم تسجيل الدفعة يدوياً.',
    deleted: 'تم مسح البيانات المحلية.', exported: 'تم تصدير النسخة الاحتياطية. الملف غير مشفّر.',
    imported: 'تم استرجاع النسخة الاحتياطية.', importSame: 'تطابق هذه النسخة البيانات المحلية الحالية.',
    importRejected: 'رُفض الاستيراد. لم يتم استبدال البيانات الحالية.',
    saveFailed: 'تعذّر الحفظ. لم يتم تحديث الحالة في الذاكرة.', savedEstimate: 'تم حفظ المبلغ التقديري.',
    storageConflict: 'تغيّرت البيانات في مكان آخر. أعد تحميل الصفحة قبل التعديل مجدداً.',
    exportFailed: 'تعذّر التصدير.', bootFailed: 'تعذّر فتح البيانات المحلية. لم يتم مسح البيانات الموجودة.',
    clearConfirm: 'هل تريد مسح كل الزبائن والأعمال من هذا المتصفح؟ لن تُحذف ملفات النسخ الاحتياطية المصدّرة.',
    importConfirm: 'سيستبدل الاستيراد كل الزبائن والأعمال المحلية. صدّر نسخة احتياطية أولاً إذا لزم الأمر. هل تريد المتابعة؟',
    deleteNothing: 'لا توجد بيانات لمسحها.', statusLabel: 'الحالة', customerLabel: 'الزبون', appointmentLabel: 'الموعد',
    estimated: 'تقدير', paid: 'مسجّل', remaining: 'المتبقي التقديري', paymentsList: 'الدفعات المسجّلة',
    recordPayment: 'إضافة دفعة', notSet: 'غير محدد', noDescription: 'لا يوجد وصف.',
    requested: 'طلب جديد', quoted: 'تم تقديم التقدير', scheduled: 'مبرمج', in_progress: 'قيد الإنجاز', completed: 'مكتمل', cancelled: 'ملغى',
    jobStatus: 'حالة العمل', paidAmount: 'المبلغ المدفوع', amountRemaining: 'المتبقي التقديري',
    clearTitle: 'مسح البيانات', recordPaymentFor: 'تسجيل دفعة لـ ', customerCardPhone: 'الهاتف: ', customerCardAddress: 'العنوان: ',
    paymentEntry: 'دفعة', malformed: 'الملف غير صالح أو غير متوافق.', tooLarge: 'حجم النسخة أكبر من الحد (10 ميغابايت).',
  },
};

let language = 'fr';
let storage;
let state = null;
let lastPersisted = null;
let generation = 0;

function t(key) {
  return messages[language][key] ?? messages.fr[key] ?? key;
}

function announce(message, kind = 'info', ready = state !== null) {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  statusEl.dataset.ready = ready ? 'true' : 'false';
}

function setText(id, key) {
  const node = $(id);
  if (node) node.textContent = t(key);
}

function applyLanguage() {
  const rtl = language === 'ar';
  document.documentElement.lang = rtl ? 'ar' : 'fr';
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.title = 'Khidma Desk — ' + (rtl ? 'إدارة الخدمات' : 'Gestion des interventions');
  $('language-select').value = language;
  const labels = {
    languageCaption: ['language','language'], eyebrow: ['eyebrow','eyebrow'], heroTitle: ['hero-title','heroTitle'],
    heroCopy: ['hero-copy','heroCopy'], privacyTitle: ['privacy-title','privacyTitle'], privacyCopy: ['privacy-copy','privacyCopy'],
    export: ['export','export'], importLabel: ['import-label','import'], clear: ['clear','clear'], customersSummary: ['customers-summary-label','customersSummary'],
    jobsSummary: ['jobs-summary-label','jobsSummary'], paymentsSummary: ['payments-summary-label','paymentsSummary'],
    customerEyebrow: ['customer-eyebrow','customerEyebrow'], customerHeading: ['customer-heading','customerHeading'],
    customerName: ['customer-name-label','customerName'], customerPhone: ['customer-phone-label','customerPhone'],
    customerAddress: ['customer-address-label','customerAddress'], customerNotes: ['customer-notes-label','customerNotes'],
    saveCustomer: ['save-customer','saveCustomer'], jobEyebrow: ['job-eyebrow','jobEyebrow'], jobHeading: ['job-heading','jobHeading'],
    jobCustomer: ['job-customer-label','jobCustomer'], jobTitle: ['job-title-label','jobTitle'], jobDescription: ['job-description-label','jobDescription'],
    appointment: ['job-appointment-label','appointment'], estimate: ['job-estimate-label','estimate'], createJob: ['save-job','createJob'],
    customersListEyebrow: ['customers-list-eyebrow','customersListEyebrow'], customers: ['customers-heading','customers'],
    jobsListEyebrow: ['jobs-list-eyebrow','jobsListEyebrow'], jobs: ['jobs-heading','jobs'],
    limits: ['limits-heading','limits'], limitsCopy: ['limits-copy','limitsCopy'], footer: ['footer','footer'],
    estimateEyebrow: ['estimate-eyebrow','estimateEyebrow'], estimateHeading: ['estimate-heading','estimateDialogTitle'], estimateAmountDialog: ['estimate-amount-label','estimateAmountLabel'], estimateWarning: ['estimate-warning','estimateWarning'], saveEstimate: ['save-estimate','saveEstimate'], cancelEstimate: ['cancel-estimate','cancel'], closeEstimate: ['close-estimate','close'],
    paymentEyebrow: ['payment-eyebrow','paymentEyebrow'], paymentHeading: ['payment-heading','payment'],
    paymentAmount: ['payment-amount-label','paymentAmount'], paymentMethod: ['payment-method-label','paymentMethod'],
    paymentReference: ['payment-reference-label','paymentReference'], paymentWarning: ['payment-warning','paymentWarning'],
    cancelPayment: ['cancel-payment','cancel'], savePayment: ['save-payment','savePayment'], closePayment: ['close-payment','close'],
  };
  for (const value of Object.values(labels)) setText(value[0], value[1]);
  $('import-file').setAttribute('aria-label', t('import'));
  $('close-payment').setAttribute('aria-label', t('close'));
  $('close-estimate').setAttribute('aria-label', t('close'));
  $('import-file').title = t('import');
  $('export').title = t('export');
  $('language-select').setAttribute('aria-label', t('language'));
  $('customer-name').placeholder = rtl ? 'الاسم أو اسم المؤسسة' : 'Nom ou entreprise';
  $('customer-phone').placeholder = t('phonePlaceholder');
  $('job-title').placeholder = t('titlePlaceholder');
  for (const option of $('payment-method').options) {
    option.textContent = t(option.value);
  }
  if (state) render();
}

function localTimestamp() {
  return new Date().toISOString();
}

function recordId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('A secure random UUID implementation is required.');
  }
  return globalThis.crypto.randomUUID();
}

function readState() {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    const initial = createEmptyState();
    const serialized = JSON.stringify(initial);
    storage.setItem(STORAGE_KEY, serialized);
    lastPersisted = serialized;
    return initial;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const failure = new Error('Saved Khidma data is not valid JSON. Existing data was left untouched.');
    failure.cause = error;
    throw failure;
  }
  const normalized = normalizeState(parsed);
  const serialized = JSON.stringify(normalized);
  if (raw !== serialized) {
    // Only canonicalize after the complete stored state has passed domain validation.
    storage.setItem(STORAGE_KEY, serialized);
  }
  lastPersisted = serialized;
  return normalized;
}

function commit(nextState) {
  const normalized = normalizeState(nextState);
  const serialized = JSON.stringify(normalized);
  let currentStored;
  try {
    currentStored = storage.getItem(STORAGE_KEY);
  } catch (error) {
    const failure = new Error('Could not verify local storage before saving.');
    failure.cause = error;
    throw failure;
  }
  if (currentStored !== lastPersisted) {
    announce(t('storageConflict'), 'error');
    throw new Error(t('storageConflict'));
  }
  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    const failure = new Error(t('saveFailed'));
    failure.cause = error;
    throw failure;
  }
  // Advance app state only after the one-key storage write succeeds.
  state = normalized;
  lastPersisted = serialized;
  generation += 1;
  render();
}

function money(amount) {
  if (amount === null || amount === undefined) return t('notSet');
  const locale = language === 'ar' ? 'ar-DZ' : 'fr-DZ';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function dateLabel(value) {
  if (!value) return t('notSet');
  const locale = language === 'ar' ? 'ar-DZ' : 'fr-DZ';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function textElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function addMeta(container, label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'job-meta-cell';
  wrapper.append(textElement('span', '', label), textElement('strong', '', value));
  container.append(wrapper);
}

function renderCustomerSelect() {
  const select = $('job-customer');
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.customers.length ? t('jobCustomer') : t('customerFirst');
  select.append(placeholder);
  for (const customer of state.customers) {
    const option = document.createElement('option');
    option.value = customer.id;
    option.textContent = customer.name;
    select.append(option);
  }
  if (state.customers.some((item) => item.id === previous)) select.value = previous;
  $('save-job').disabled = state.customers.length === 0;
}

function renderCustomers() {
  const host = $('customer-list');
  host.replaceChildren();
  $('customers-list-count').textContent = String(state.customers.length);
  $('customers-count').textContent = String(state.customers.length);
  if (state.customers.length === 0) {
    host.append(textElement('p', 'empty', t('noCustomers')));
    return;
  }
  for (const customer of state.customers) {
    const card = document.createElement('article');
    card.className = 'customer-card';
    card.append(textElement('strong', '', customer.name));
    if (customer.phone) card.append(textElement('p', 'card-meta', t('customerCardPhone') + customer.phone));
    if (customer.address) card.append(textElement('p', 'card-meta', t('customerCardAddress') + customer.address));
    if (customer.notes) card.append(textElement('p', 'card-meta', customer.notes));
    host.append(card);
  }
}

function renderJobs() {
  const host = $('job-list');
  host.replaceChildren();
  $('jobs-list-count').textContent = String(state.jobs.length);
  const openJobs = state.jobs.filter((job) => job.status !== 'completed' && job.status !== 'cancelled').length;
  $('jobs-count').textContent = String(openJobs);
  const totalPayments = state.jobs.reduce((sum, job) => sum + paymentTotal(job), 0);
  $('payments-total').textContent = money(totalPayments);
  if (state.jobs.length === 0) {
    host.append(textElement('p', 'empty', t('noJobs')));
    return;
  }

  for (const job of [...state.jobs].reverse()) {
    const card = document.createElement('article');
    card.className = 'job-card';
    const top = document.createElement('div');
    top.className = 'job-top';
    top.append(textElement('h3', '', job.title), textElement('span', 'status-chip', t(job.status)));
    card.append(top);

    const customer = state.customers.find((item) => item.id === job.customerId);
    card.append(textElement('p', 'card-meta', t('customerLabel') + ': ' + (customer?.name ?? t('notSet'))));
    if (job.description) card.append(textElement('p', 'job-detail', job.description));

    const meta = document.createElement('div');
    meta.className = 'job-meta-grid';
    addMeta(meta, t('estimated'), money(job.quotedAmountDzd));
    addMeta(meta, t('paidAmount'), money(paymentTotal(job)));
    addMeta(meta, t('amountRemaining'), job.quotedAmountDzd === null ? t('notSet') : money(job.quotedAmountDzd - paymentTotal(job)));
    addMeta(meta, t('appointmentLabel'), dateLabel(job.appointmentAt));
    card.append(meta);

    const actions = document.createElement('div');
    actions.className = 'job-actions';
    const statusLabel = document.createElement('label');
    statusLabel.append(textElement('span', '', t('jobStatus')));
    const statusSelect = document.createElement('select');
    statusSelect.setAttribute('aria-label', t('jobStatus') + ': ' + job.title);
    statusSelect.dataset.jobId = job.id;
    const currentOption = document.createElement('option');
    currentOption.value = job.status;
    currentOption.textContent = t(job.status);
    statusSelect.append(currentOption);
    for (const nextStatus of ['quoted', 'scheduled', 'in_progress', 'completed', 'cancelled']) {
      if (canTransitionJob(job.status, nextStatus)) {
        const option = document.createElement('option');
        option.value = nextStatus;
        option.textContent = t(nextStatus);
        statusSelect.append(option);
      }
    }
    statusSelect.value = job.status;
    statusSelect.addEventListener('change', () => {
      try {
        commit(transitionJob(state, job.id, statusSelect.value, localTimestamp()));
        announce(t('ready'));
      } catch (error) {
        render();
        announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
      }
    });
    statusLabel.append(statusSelect);

    const paymentButton = textElement('button', 'button secondary', t('recordPayment'));
    paymentButton.type = 'button';
    paymentButton.dataset.action = 'payment';
    paymentButton.disabled = job.quotedAmountDzd === null || paymentTotal(job) >= job.quotedAmountDzd;
    const estimateButton = textElement('button', 'button secondary', t('updateEstimate'));
    estimateButton.type = 'button';
    estimateButton.dataset.action = 'estimate';
    estimateButton.title = t('updateEstimate');
    estimateButton.addEventListener('click', () => {
      $('estimate-job-id').value = job.id;
      $('estimate-amount').value = job.quotedAmountDzd === null ? '' : String(job.quotedAmountDzd);
      $('estimate-dialog').showModal();
      $('estimate-amount').focus();
    });

    paymentButton.addEventListener('click', () => {
      $('payment-job-id').value = job.id;
      $('payment-amount').value = '';
      $('payment-reference').value = '';
      $('payment-method').value = 'cash';
      $('payment-dialog').showModal();
      $('payment-amount').focus();
    });
    actions.append(statusLabel, estimateButton, paymentButton);
    card.append(actions);

    if (job.payments.length) {
      const details = document.createElement('details');
      details.className = 'payment-list';
      details.append(textElement('summary', '', t('paymentsList') + ' (' + job.payments.length + ')'));
      for (const payment of job.payments) {
        const methodLabel = t(payment.method);
        const suffix = payment.reference ? ' · ' + payment.reference : '';
        details.append(textElement('div', 'payment-entry', money(payment.amountDzd) + ' · ' + methodLabel + ' · ' + dateLabel(payment.recordedAt) + suffix));
      }
      card.append(details);
    }
    host.append(card);
  }
}

function render() {
  if (!state) return;
  renderCustomerSelect();
  renderCustomers();
  renderJobs();
}

function disableDataControls() {
  for (const element of document.querySelectorAll('#customer-form input, #customer-form textarea, #customer-form button, #job-form input, #job-form textarea, #job-form select, #job-form button, #export, #clear, #import-file')) {
    element.disabled = true;
  }
}

function showFailure(error) {
  disableDataControls();
  announce(t('bootFailed') + ' ' + (error.message || ''), 'error', false);
  $('customer-list').replaceChildren(textElement('p', 'empty', t('bootFailed')));
  $('job-list').replaceChildren(textElement('p', 'empty', t('bootFailed')));
}

function downloadJson(filename, value) {
  const content = JSON.stringify(value, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('customer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  const now = localTimestamp();
  const customer = {
    id: recordId(),
    name: $('customer-name').value,
    phone: $('customer-phone').value,
    address: $('customer-address').value,
    notes: $('customer-notes').value,
    createdAt: now,
    updatedAt: now,
  };
  try {
    commit(addCustomer(state, customer));
    $('customer-form').reset();
    announce(t('savedCustomer'));
  } catch (error) {
    announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
  }
});

$('job-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  const now = localTimestamp();
  let appointmentAt = null;
  if ($('job-appointment').value) {
    const date = new Date($('job-appointment').value);
    if (!Number.isFinite(date.valueOf())) {
      announce(t('saveFailed'), 'error'); return;
    }
    appointmentAt = date.toISOString();
  }
  const quoteText = $('job-estimate').value.trim();
  const quote = quoteText === '' ? null : Number(quoteText);
  const job = {
    id: recordId(),
    customerId: $('job-customer').value,
    title: $('job-title').value,
    description: $('job-description').value,
    status: appointmentAt ? 'scheduled' : quote !== null ? 'quoted' : 'requested',
    appointmentAt,
    quotedAmountDzd: quote,
    payments: [],
    createdAt: now,
    updatedAt: now,
  };
  try {
    commit(addJob(state, job));
    $('job-form').reset();
    announce(t('savedJob'));
  } catch (error) {
    announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
  }
});

$('estimate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  const jobId = $('estimate-job-id').value;
  const amountText = $('estimate-amount').value.trim();
  const amount = amountText === '' ? null : Number(amountText);
  try {
    commit(updateJobEstimate(state, jobId, amount, localTimestamp()));
    $('estimate-dialog').close();
    announce(t('savedEstimate'));
  } catch (error) {
    announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
  }
});

$('close-estimate').addEventListener('click', () => $('estimate-dialog').close());
$('cancel-estimate').addEventListener('click', () => $('estimate-dialog').close());

$('payment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  const jobId = $('payment-job-id').value;
  const payment = {
    id: recordId(),
    amountDzd: Number($('payment-amount').value),
    method: $('payment-method').value,
    reference: $('payment-reference').value,
    recordedAt: localTimestamp(),
  };
  try {
    commit(recordPayment(state, jobId, payment));
    $('payment-dialog').close();
    announce(t('savedPayment'));
  } catch (error) {
    announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
  }
});

$('close-payment').addEventListener('click', () => $('payment-dialog').close());
$('cancel-payment').addEventListener('click', () => $('payment-dialog').close());

$('export').addEventListener('click', async () => {
  if (!state) return;
  try {
    const archive = await createArchive({
      appId: 'khidma-desk',
      schemaVersion: 1,
      data: state,
      metadata: { purpose: 'khidma-desk-backup', locale: language },
      maxBytes: MAX_ARCHIVE_BYTES,
    });
    downloadJson('khidma-desk-' + new Date().toISOString().slice(0, 10) + '.json', archive);
    announce(t('exported'));
  } catch (error) {
    announce(t('exportFailed') + ' ' + (error.message || ''), 'error');
  }
});

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!state || !file) return;
  if (file.size > MAX_ARCHIVE_BYTES) {
    announce(t('tooLarge'), 'error'); return;
  }
  if ((state.customers.length || state.jobs.length) && !window.confirm(t('importConfirm'))) {
    announce(t('importRejected')); return;
  }
  const capturedGeneration = generation;
  let capturedStorage;
  const capturedState = JSON.stringify(state);
  try {
    capturedStorage = storage.getItem(STORAGE_KEY);
  } catch (error) {
    announce(t('importRejected') + ' ' + (error.message || ''), 'error'); return;
  }
  if (capturedStorage !== lastPersisted) {
    announce(t('storageConflict'), 'error'); return;
  }
  try {
    const archive = await parseArchive(await file.text(), {
      expectedAppId: 'khidma-desk',
      targetSchemaVersion: 1,
      maxBytes: MAX_ARCHIVE_BYTES,
      validateData: (data) => {
        normalizeState(data);
        return true;
      },
    });
    const restored = normalizeState(archive.data);
    if (generation !== capturedGeneration || JSON.stringify(state) !== capturedState || storage.getItem(STORAGE_KEY) !== capturedStorage) {
      announce(t('storageConflict'), 'error'); return;
    }
    const serialized = JSON.stringify(restored);
    if (serialized === lastPersisted) {
      announce(t('importSame')); return;
    }
    // Validate the entire replacement before the one-key write.
    storage.setItem(STORAGE_KEY, serialized);
    state = restored;
    lastPersisted = serialized;
    generation += 1;
    render();
    announce(t('imported'));
  } catch (error) {
    const detail = error instanceof PortableArchiveError || error instanceof KhidmaError ? error.message : t('malformed');
    announce(t('importRejected') + ' ' + detail, 'error');
  }
});

$('clear').addEventListener('click', () => {
  if (!state) return;
  if (!state.customers.length && !state.jobs.length) {
    announce(t('deleteNothing')); return;
  }
  if (!window.confirm(t('clearConfirm'))) return;
  try {
    commit(createEmptyState());
    announce(t('deleted'));
  } catch (error) {
    announce(t('saveFailed') + ' ' + (error.message || ''), 'error');
  }
});

$('language-select').addEventListener('change', () => {
  language = $('language-select').value === 'ar' ? 'ar' : 'fr';
  try { window.localStorage.setItem(LANGUAGE_KEY, language); } catch {}
  applyLanguage();
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && event.newValue !== lastPersisted) {
    announce(t('storageConflict'), 'error');
  }
});

try {
  storage = window.localStorage;
  try {
    language = storage.getItem(LANGUAGE_KEY) === 'ar' ? 'ar' : 'fr';
  } catch {}
  state = readState();
  applyLanguage();
  render();
  announce(t('ready'), 'info', true);
} catch (error) {
  state = null;
  showFailure(error);
}
