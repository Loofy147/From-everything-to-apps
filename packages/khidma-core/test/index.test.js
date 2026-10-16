import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCustomer,
  addJob,
  canTransitionJob,
  createEmptyState,
  KhidmaError,
  normalizeState,
  paymentTotal,
  recordPayment,
  transitionJob,
  updateJobEstimate,
} from '../src/index.js';

const t0 = '2026-10-16T10:00:00.000Z';
const t1 = '2026-10-16T10:05:00.000Z';
const t2 = '2026-10-16T10:10:00.000Z';
const t3 = '2026-10-16T10:20:00.000Z';

function seed() {
  const customer = { id: 'c1', name: 'Atelier Al Amal', phone: '+213 555 123 456', address: 'Blida', notes: '', createdAt: t0, updatedAt: t0 };
  const job = { id: 'j1', customerId: 'c1', title: 'Réparation climatiseur', description: 'Vérifier la pièce', status: 'requested', appointmentAt: null, quotedAmountDzd: null, payments: [], createdAt: t0, updatedAt: t0 };
  let state = addCustomer(createEmptyState(), customer);
  state = addJob(state, job);
  return state;
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof KhidmaError);
    assert.equal(error.code, code);
    return true;
  });
}

test('normalizes state and preserves customer, job and DZD estimate fields', () => {
  let state = seed();
  state = updateJobEstimate(state, 'j1', 12000, t1);
  assert.equal(state.jobs[0].quotedAmountDzd, 12000);
  assert.equal(state.jobs[0].customerId, 'c1');
  assert.equal(normalizeState(state).jobs.length, 1);
});

test('rejects a job that references a missing customer', () => {
  const state = createEmptyState();
  expectCode(() => addJob(state, { id: 'j1', customerId: 'missing', title: 'Repair', description: '', status: 'requested', appointmentAt: null, quotedAmountDzd: null, payments: [], createdAt: t0, updatedAt: t0 }), 'missing-customer');
});

test('rejects duplicate customer and job identifiers', () => {
  const state = seed();
  expectCode(() => addCustomer(state, { id: 'c1', name: 'Duplicate', phone: '', address: '', notes: '', createdAt: t0, updatedAt: t0 }), 'duplicate-customer');
  expectCode(() => addJob(state, { ...state.jobs[0], title: 'Duplicate job' }), 'duplicate-job');
});

test('status transition table allows intended forward transitions only', () => {
  assert.equal(canTransitionJob('requested', 'quoted'), true);
  assert.equal(canTransitionJob('requested', 'in_progress'), true);
  assert.equal(canTransitionJob('completed', 'in_progress'), false);
  assert.equal(canTransitionJob('cancelled', 'requested'), false);
  let state = transitionJob(seed(), 'j1', 'quoted', t1);
  state = transitionJob(state, 'j1', 'scheduled', t2);
  state = transitionJob(state, 'j1', 'in_progress', t3);
  assert.equal(state.jobs[0].status, 'in_progress');
});

test('rejects invalid job transitions and reopening terminal work', () => {
  expectCode(() => transitionJob(seed(), 'j1', 'completed', t1), 'invalid-status-transition');
  let state = transitionJob(seed(), 'j1', 'cancelled', t1);
  expectCode(() => transitionJob(state, 'j1', 'requested', t2), 'invalid-status-transition');
});

test('accepts whole non-negative DZD estimates and rejects fractions, negatives and overflow', () => {
  const state = seed();
  expectCode(() => updateJobEstimate(state, 'j1', 12.5, t1), 'invalid-data');
  expectCode(() => updateJobEstimate(state, 'j1', -10, t1), 'invalid-data');
  expectCode(() => updateJobEstimate(state, 'j1', Number.MAX_SAFE_INTEGER, t1), 'invalid-data');
});

test('records manual payments and computes cumulative totals', () => {
  let state = updateJobEstimate(seed(), 'j1', 12000, t1);
  state = recordPayment(state, 'j1', { id: 'p1', amountDzd: 3000, method: 'cash', reference: 'Receipt note 1', recordedAt: t2 });
  state = recordPayment(state, 'j1', { id: 'p2', amountDzd: 4000, method: 'edahabia', reference: '', recordedAt: t3 });
  assert.equal(paymentTotal(state.jobs[0]), 7000);
  assert.equal(state.jobs[0].payments.length, 2);
});

test('does not let recorded payments exceed an estimate or exist without one', () => {
  const payment = { id: 'p1', amountDzd: 100, method: 'cash', reference: '', recordedAt: t1 };
  expectCode(() => recordPayment(seed(), 'j1', payment), 'missing-estimate');
  const state = updateJobEstimate(seed(), 'j1', 100, t1);
  expectCode(() => recordPayment(state, 'j1', payment), 'payment-exceeds-estimate');
});

test('does not lower or remove an estimate below previously recorded payments', () => {
  let state = updateJobEstimate(seed(), 'j1', 1000, t1);
  state = recordPayment(state, 'j1', { id: 'p1', amountDzd: 500, method: 'bank_transfer', reference: '', recordedAt: t2 });
  expectCode(() => updateJobEstimate(state, 'j1', 400, t3), 'invalid-estimate');
  expectCode(() => updateJobEstimate(state, 'j1', null, t3), 'invalid-estimate');
});

test('rejects malformed dates, long text, invalid methods, and extra keys', () => {
  const state = seed();
  expectCode(() => addCustomer(state, { id: 'c2', name: ' x '.repeat(50), phone: '', address: '', notes: '', createdAt: t0, updatedAt: t0 }), 'invalid-data');
  expectCode(() => addCustomer(state, { id: 'c2', name: 'Valid', phone: '', address: '', notes: '', createdAt: 'not-date', updatedAt: t0 }), 'invalid-data');
  const job = { ...state.jobs[0], extra: true };
  expectCode(() => normalizeState({ ...state, jobs: [job] }), 'invalid-data');
  const withQuote = updateJobEstimate(state, 'j1', 1000, t1);
  expectCode(() => recordPayment(withQuote, 'j1', { id: 'p1', amountDzd: 1, method: 'crypto', reference: '', recordedAt: t2 }), 'invalid-data');
});

test('rejects payment identifiers duplicated within the same job', () => {
  let state = updateJobEstimate(seed(), 'j1', 100, t1);
  state = recordPayment(state, 'j1', { id: 'p1', amountDzd: 20, method: 'cash', reference: '', recordedAt: t2 });
  expectCode(() => recordPayment(state, 'j1', { id: 'p1', amountDzd: 20, method: 'cash', reference: '', recordedAt: t3 }), 'duplicate-payment');
});

test('updates the job timestamp monotonically when the wall clock moves backward', () => {
  const state = transitionJob(seed(), 'j1', 'quoted', t2);
  const updated = transitionJob(state, 'j1', 'scheduled', t1);
  assert.equal(updated.jobs[0].updatedAt, t2);
});
