export const KHIDMA_SCHEMA_VERSION = 1;
export const JOB_STATUSES = Object.freeze(['requested', 'quoted', 'scheduled', 'in_progress', 'completed', 'cancelled']);
export const PAYMENT_METHODS = Object.freeze(['cash', 'bank_transfer', 'cib', 'edahabia', 'other']);
const statusSet = new Set(JOB_STATUSES);
const paymentMethodSet = new Set(PAYMENT_METHODS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CUSTOMERS = 5000;
const MAX_JOBS = 25000;
const MAX_PAYMENTS_PER_JOB = 1000;
const MAX_DZD = 1_000_000_000_000;
const STATE_KEYS = new Set(['schemaVersion', 'customers', 'jobs']);
const CUSTOMER_KEYS = new Set(['id', 'name', 'phone', 'address', 'notes', 'createdAt', 'updatedAt']);
const JOB_KEYS = new Set(['id', 'customerId', 'title', 'description', 'status', 'appointmentAt', 'quotedAmountDzd', 'payments', 'createdAt', 'updatedAt']);
const PAYMENT_KEYS = new Set(['id', 'amountDzd', 'method', 'reference', 'recordedAt']);

export class KhidmaError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'KhidmaError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new KhidmaError(code, message, cause ? { cause } : undefined);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)) fail('invalid-data', label + ' must be a plain object.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('invalid-data', label + ' must not contain symbol fields.');
    if (!keys.has(key)) fail('invalid-data', 'Unsupported ' + label + ' field: ' + key + '.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('invalid-data', label + ' fields must be enumerable data properties.');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('invalid-data', 'Missing ' + label + ' field: ' + key + '.');
  }
}

function cleanText(value, label, { min = 0, max, optional = false } = {}) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string') fail('invalid-data', label + ' must be text.');
  if (value.length > max) fail('invalid-data', label + ' exceeds ' + max + ' characters.');
  const normalized = value.trim();
  if (normalized.length < min) fail('invalid-data', label + ' must contain at least ' + min + ' characters.');
  return normalized;
}

function optionalText(value, label, max) {
  if (value === undefined || value === null) return '';
  return cleanText(value, label, { max });
}

function identifier(value, label = 'id') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('invalid-data', label + ' is not a valid identifier.');
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail('invalid-data', label + ' must be a UTC ISO timestamp.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail('invalid-data', label + ' must be a real UTC timestamp.');
  return value;
}

function optionalTimestamp(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value, label);
}

function safeDzd(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DZD) {
    fail('invalid-data', label + ' must be a whole-DZD integer between 0 and ' + MAX_DZD + '.');
  }
  return value;
}

function normalizePayment(payment) {
  exactObject(payment, PAYMENT_KEYS, 'payment');
  const id = identifier(payment.id, 'payment id');
  const amountDzd = safeDzd(payment.amountDzd, 'payment amount');
  if (amountDzd < 1) fail('invalid-data', 'Payment amount must be greater than zero.');
  if (!paymentMethodSet.has(payment.method)) fail('invalid-data', 'Payment method is not supported.');
  const reference = cleanText(payment.reference, 'payment reference', { max: 160 });
  return {
    id,
    amountDzd,
    method: payment.method,
    reference,
    recordedAt: timestamp(payment.recordedAt, 'payment recordedAt'),
  };
}

export function normalizeCustomer(input) {
  exactObject(input, CUSTOMER_KEYS, 'customer');
  const createdAt = timestamp(input.createdAt, 'customer createdAt');
  const updatedAt = timestamp(input.updatedAt, 'customer updatedAt');
  if (updatedAt < createdAt) fail('invalid-data', 'Customer updatedAt cannot precede createdAt.');
  return {
    id: identifier(input.id, 'customer id'),
    name: cleanText(input.name, 'customer name', { min: 1, max: 120 }),
    phone: optionalText(input.phone, 'customer phone', 40),
    address: optionalText(input.address, 'customer address', 400),
    notes: optionalText(input.notes, 'customer notes', 1000),
    createdAt,
    updatedAt,
  };
}

export function normalizeJob(input) {
  exactObject(input, JOB_KEYS, 'job');
  const createdAt = timestamp(input.createdAt, 'job createdAt');
  const updatedAt = timestamp(input.updatedAt, 'job updatedAt');
  if (updatedAt < createdAt) fail('invalid-data', 'Job updatedAt cannot precede createdAt.');
  const status = input.status;
  if (!statusSet.has(status)) fail('invalid-data', 'Job status is not supported.');
  if (!Array.isArray(input.payments)) fail('invalid-data', 'Job payments must be an array.');
  if (input.payments.length > MAX_PAYMENTS_PER_JOB) fail('invalid-data', 'The payment entry limit for a job was exceeded.');
  const payments = input.payments.map(normalizePayment);
  const paymentIds = new Set();
  for (const payment of payments) {
    if (paymentIds.has(payment.id)) fail('invalid-data', 'Duplicate payment id: ' + payment.id + '.');
    paymentIds.add(payment.id);
  }
  const quotedAmountDzd = safeDzd(input.quotedAmountDzd, 'estimated amount', { nullable: true });
  const paidAmount = payments.reduce((sum, item) => sum + item.amountDzd, 0);
  if (!Number.isSafeInteger(paidAmount)) fail('invalid-data', 'Cumulative payment amount exceeds the supported integer range.');
  if (payments.length && quotedAmountDzd === null) fail('invalid-data', 'A job must have an estimated amount before recording payment.');
  if (quotedAmountDzd !== null && paidAmount > quotedAmountDzd) fail('invalid-data', 'Cumulative recorded payments cannot exceed the estimated amount.');
  return {
    id: identifier(input.id, 'job id'),
    customerId: identifier(input.customerId, 'job customerId'),
    title: cleanText(input.title, 'job title', { min: 1, max: 150 }),
    description: optionalText(input.description, 'job description', 3000),
    status,
    appointmentAt: optionalTimestamp(input.appointmentAt, 'job appointmentAt'),
    quotedAmountDzd,
    payments,
    createdAt,
    updatedAt,
  };
}

export function createEmptyState() {
  return { schemaVersion: KHIDMA_SCHEMA_VERSION, customers: [], jobs: [] };
}

export function normalizeState(input) {
  exactObject(input, STATE_KEYS, 'state');
  if (input.schemaVersion !== KHIDMA_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'Unsupported Khidma data schema version: ' + String(input.schemaVersion) + '.');
  }
  if (!Array.isArray(input.customers) || input.customers.length > MAX_CUSTOMERS) fail('invalid-data', 'Customers must be an array within the supported limit.');
  if (!Array.isArray(input.jobs) || input.jobs.length > MAX_JOBS) fail('invalid-data', 'Jobs must be an array within the supported limit.');
  const customers = input.customers.map(normalizeCustomer);
  const jobs = input.jobs.map(normalizeJob);
  const customerIds = new Set();
  for (const customer of customers) {
    if (customerIds.has(customer.id)) fail('invalid-data', 'Duplicate customer id: ' + customer.id + '.');
    customerIds.add(customer.id);
  }
  const jobIds = new Set();
  for (const job of jobs) {
    if (jobIds.has(job.id)) fail('invalid-data', 'Duplicate job id: ' + job.id + '.');
    jobIds.add(job.id);
    if (!customerIds.has(job.customerId)) fail('invalid-data', 'Job ' + job.id + ' references a missing customer.');
  }
  return { schemaVersion: KHIDMA_SCHEMA_VERSION, customers, jobs };
}

export function addCustomer(state, input) {
  const current = normalizeState(state);
  const customer = normalizeCustomer(input);
  if (current.customers.some((item) => item.id === customer.id)) fail('duplicate-customer', 'A customer with this id already exists.');
  return normalizeState({ ...current, customers: [...current.customers, customer] });
}

export function addJob(state, input) {
  const current = normalizeState(state);
  const job = normalizeJob(input);
  if (current.jobs.some((item) => item.id === job.id)) fail('duplicate-job', 'A job with this id already exists.');
  if (!current.customers.some((item) => item.id === job.customerId)) fail('missing-customer', 'The selected customer does not exist.');
  return normalizeState({ ...current, jobs: [...current.jobs, job] });
}

const TRANSITIONS = Object.freeze({
  requested: new Set(['quoted', 'scheduled', 'in_progress', 'cancelled']),
  quoted: new Set(['scheduled', 'in_progress', 'cancelled']),
  scheduled: new Set(['in_progress', 'completed', 'cancelled']),
  in_progress: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
});

export function canTransitionJob(from, to) {
  return statusSet.has(from) && statusSet.has(to) && Boolean(TRANSITIONS[from]?.has(to));
}

export function transitionJob(state, jobId, nextStatus, updatedAt) {
  const current = normalizeState(state);
  timestamp(updatedAt, 'job updatedAt');
  const existing = current.jobs.find((item) => item.id === jobId);
  if (!existing) fail('job-not-found', 'Job not found: ' + jobId + '.');
  if (!canTransitionJob(existing.status, nextStatus)) {
    fail('invalid-status-transition', 'Cannot change job status from ' + existing.status + ' to ' + String(nextStatus) + '.');
  }
  const nextJobs = current.jobs.map((job) => job.id === jobId ? { ...job, status: nextStatus, updatedAt: updatedAt < job.updatedAt ? job.updatedAt : updatedAt } : job);
  return normalizeState({ ...current, jobs: nextJobs });
}

export function updateJobEstimate(state, jobId, quotedAmountDzd, updatedAt) {
  const current = normalizeState(state);
  timestamp(updatedAt, 'job updatedAt');
  const amount = safeDzd(quotedAmountDzd, 'estimated amount', { nullable: true });
  const existing = current.jobs.find((item) => item.id === jobId);
  if (!existing) fail('job-not-found', 'Job not found: ' + jobId + '.');
  const paid = existing.payments.reduce((sum, payment) => sum + payment.amountDzd, 0);
  if (amount === null && paid > 0) fail('invalid-estimate', 'Cannot remove the estimate while payments are recorded.');
  if (amount !== null && amount < paid) fail('invalid-estimate', 'Estimate cannot be lower than payments already recorded.');
  const nextJobs = current.jobs.map((job) => job.id === jobId ? { ...job, quotedAmountDzd: amount, updatedAt: updatedAt < job.updatedAt ? job.updatedAt : updatedAt } : job);
  return normalizeState({ ...current, jobs: nextJobs });
}

export function recordPayment(state, jobId, input) {
  const current = normalizeState(state);
  const existing = current.jobs.find((item) => item.id === jobId);
  if (!existing) fail('job-not-found', 'Job not found: ' + jobId + '.');
  const payment = normalizePayment(input);
  if (existing.quotedAmountDzd === null) fail('missing-estimate', 'Set an estimated amount before recording a payment.');
  if (existing.payments.some((item) => item.id === payment.id)) fail('duplicate-payment', 'A payment with this id already exists.');
  const cumulative = existing.payments.reduce((sum, item) => sum + item.amountDzd, 0) + payment.amountDzd;
  if (!Number.isSafeInteger(cumulative) || cumulative > existing.quotedAmountDzd) {
    fail('payment-exceeds-estimate', 'Cumulative recorded payments cannot exceed the estimated amount.');
  }
  const nextJobs = current.jobs.map((job) => job.id === jobId
    ? { ...job, payments: [...job.payments, payment], updatedAt: payment.recordedAt < job.updatedAt ? job.updatedAt : payment.recordedAt }
    : job);
  return normalizeState({ ...current, jobs: nextJobs });
}

export function paymentTotal(job) {
  const normalized = normalizeJob(job);
  return normalized.payments.reduce((sum, payment) => sum + payment.amountDzd, 0);
}
