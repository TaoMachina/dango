import { z } from 'zod';
import type { ID, Routine, Schedule } from '../shared/types.ts';
import type { Events } from './events.ts';
import type { Runs } from './routing.ts';
import { now, type Store } from './store.ts';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time }),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().positive() }),
  z.object({ kind: z.literal('once'), at: z.iso.datetime({ offset: true }) }),
]);

// The next time a schedule fires after `from`, in local time. A past 'once' fires as soon as the hub can.
export function nextRunAt(schedule: Schedule, from: Date): string | null {
  if (schedule.kind === 'interval') return new Date(from.getTime() + schedule.minutes * 60_000).toISOString();
  if (schedule.kind === 'once') return new Date(schedule.at).toISOString();
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (schedule.kind === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1);
  } else {
    next.setDate(next.getDate() + ((schedule.day - next.getDay() + 7) % 7));
    if (next <= from) next.setDate(next.getDate() + 7);
  }
  return next.toISOString();
}

// setTimeout holds at most 2^31-1 ms (about 24.8 days); a later routine re-arms when that timer ends.
const MAX_TIMER_MS = 2 ** 31 - 1;

export class Routines {
  private store: Store;
  private events: Events;
  private runs: Runs;
  private timer: NodeJS.Timeout | null = null;

  constructor(store: Store, events: Events, runs: Runs) {
    this.store = store;
    this.events = events;
    this.runs = runs;
  }

  create(input: { conversationId: ID; agentId: ID; title: string; prompt: string; schedule: Schedule }): Routine {
    const routine = this.store.insertRoutine({ ...input, nextRunAt: nextRunAt(input.schedule, new Date()) });
    this.emit(routine);
    this.arm();
    return routine;
  }

  update(id: ID, patch: Partial<Pick<Routine, 'title' | 'prompt' | 'schedule' | 'enabled'>>): Routine {
    const current = this.store.getRoutine(id)!;
    const schedule = patch.schedule ?? current.schedule;
    const enabled = patch.enabled ?? current.enabled;
    const reschedule = patch.schedule !== undefined || (patch.enabled === true && !current.enabled);
    const routine = this.store.updateRoutine(id, { ...patch, nextRunAt: !enabled ? null : reschedule ? nextRunAt(schedule, new Date()) : current.nextRunAt });
    this.emit(routine);
    this.arm();
    return routine;
  }

  delete(id: ID) {
    this.store.deleteRoutine(id);
    this.events.emit({ type: 'routine.removed', routineId: id });
    this.arm();
  }

  // Runs a routine now without moving its schedule.
  runNow(id: ID) {
    this.fire(this.store.getRoutine(id)!, false);
  }

  arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const due = this.store.listRoutines().filter(r => r.enabled && r.nextRunAt).map(r => Date.parse(r.nextRunAt!));
    if (due.length === 0) return;
    const delay = Math.min(Math.max(0, Math.min(...due) - Date.now()), MAX_TIMER_MS);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick() {
    const at = Date.now();
    for (const routine of this.store.listRoutines()) {
      if (routine.enabled && routine.nextRunAt && Date.parse(routine.nextRunAt) <= at) this.fire(routine, true);
    }
    this.arm();
  }

  private fire(routine: Routine, scheduled: boolean) {
    const message = this.runs.postMessage(routine.conversationId, { type: 'system' }, `Routine: ${routine.title}`);
    this.runs.startRun({ conversationId: routine.conversationId, agentId: routine.agentId, triggerMessageId: message.id, parentRunId: null, depth: 0, prompt: routine.prompt });
    const once = routine.schedule.kind === 'once';
    const patch = scheduled
      ? { lastRunAt: now(), nextRunAt: once ? null : nextRunAt(routine.schedule, new Date()), enabled: !once }
      : { lastRunAt: now() };
    this.emit(this.store.updateRoutine(routine.id, patch));
  }

  private emit(routine: Routine) {
    this.events.emit({ type: 'routine.upsert', routine });
  }
}
