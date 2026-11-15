import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextRunAt } from '../server/routines.ts';

// Wednesday 2026-11-11 10:30 local time.
const wednesday = new Date(2026, 10, 11, 10, 30);

test('daily runs later today, or tomorrow once the time has passed', () => {
  assert.equal(nextRunAt({ kind: 'daily', time: '18:00' }, wednesday), new Date(2026, 10, 11, 18, 0).toISOString());
  assert.equal(nextRunAt({ kind: 'daily', time: '09:15' }, wednesday), new Date(2026, 10, 12, 9, 15).toISOString());
  assert.equal(nextRunAt({ kind: 'daily', time: '10:30' }, wednesday), new Date(2026, 10, 12, 10, 30).toISOString());
});

test('weekly runs on the next matching weekday', () => {
  assert.equal(nextRunAt({ kind: 'weekly', day: 5, time: '08:00' }, wednesday), new Date(2026, 10, 13, 8, 0).toISOString());
  assert.equal(nextRunAt({ kind: 'weekly', day: 0, time: '08:00' }, wednesday), new Date(2026, 10, 15, 8, 0).toISOString());
  // Same weekday: later today, or a week later once the time has passed.
  assert.equal(nextRunAt({ kind: 'weekly', day: 3, time: '12:00' }, wednesday), new Date(2026, 10, 11, 12, 0).toISOString());
  assert.equal(nextRunAt({ kind: 'weekly', day: 3, time: '09:00' }, wednesday), new Date(2026, 10, 18, 9, 0).toISOString());
});
