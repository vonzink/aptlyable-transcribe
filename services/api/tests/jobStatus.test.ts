import test from 'node:test';
import assert from 'node:assert/strict';
import { isActive, isTerminal, ALL_STATUSES } from '../src/types/job';

test('terminal statuses', () => {
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('failed'), true);
  assert.equal(isTerminal('queued'), false);
  assert.equal(isTerminal('transcribing'), false);
});

test('active statuses', () => {
  assert.equal(isActive('queued'), true);
  assert.equal(isActive('transcribing'), true);
  assert.equal(isActive('uploaded'), true);
  assert.equal(isActive('pending_upload'), false);
  assert.equal(isActive('completed'), false);
});

test('all statuses set is exhaustive', () => {
  assert.equal(ALL_STATUSES.length, 6);
});
