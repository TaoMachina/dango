import { useMemo, useState } from 'react';
import { Clock, Play, Plus, Trash2 } from 'lucide-react';
import type { Conversation, ID, Schedule } from '../../../shared/types.ts';
import { Button, IconButton, inputClass, Label, SectionTitle, Switch, textareaClass } from '../components/ui.tsx';
import { createRoutine, deleteRoutine, patchRoutine, runRoutine } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';
import { fullTime } from '../lib/time.ts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock(time: string) {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function describeSchedule(schedule: Schedule) {
  switch (schedule.kind) {
    case 'daily':
      return `Every day at ${clock(schedule.time)}`;
    case 'weekly':
      return `Every ${DAYS[schedule.day]} at ${clock(schedule.time)}`;
    case 'interval':
      if (schedule.minutes % 60 === 0) return schedule.minutes === 60 ? 'Every hour' : `Every ${schedule.minutes / 60} hours`;
      return schedule.minutes === 1 ? 'Every minute' : `Every ${schedule.minutes} minutes`;
    case 'once':
      return `Once on ${fullTime(schedule.at)}`;
  }
}

function RoutineForm({ conversation, onDone }: { conversation: Conversation; onDone: () => void }) {
  const agents = useStore((s) => s.agents);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<Schedule['kind']>('daily');
  // Prefilled starting points the person edits: start of a workday, today, hourly.
  const [time, setTime] = useState('09:00');
  const [day, setDay] = useState(new Date().getDay());
  const [minutes, setMinutes] = useState(60);
  const [at, setAt] = useState('');
  const [agentId, setAgentId] = useState<ID>(conversation.leadId ?? conversation.memberIds[0]);
  const [busy, setBusy] = useState(false);

  const schedule: Schedule | null =
    kind === 'daily'
      ? { kind, time }
      : kind === 'weekly'
        ? { kind, day, time }
        : kind === 'interval'
          ? minutes >= 1
            ? { kind, minutes }
            : null
          : at
            ? { kind, at: new Date(at).toISOString() }
            : null;

  return (
    <form
      className="mx-2 mb-2 flex flex-col gap-2.5 rounded-2xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void createRoutine({ conversationId: conversation.id, agentId, title: title.trim(), prompt: prompt.trim(), schedule: schedule! })
          .then(onDone)
          .finally(() => setBusy(false));
      }}
    >
      <div>
        <Label htmlFor="routine-title">Title</Label>
        <input id="routine-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning check-in" />
      </div>
      <div>
        <Label htmlFor="routine-prompt">Prompt</Label>
        <textarea id="routine-prompt" rows={3} className={textareaClass} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should happen?" />
      </div>
      {conversation.kind === 'group' && (
        <div>
          <Label htmlFor="routine-agent">Agent</Label>
          <select id="routine-agent" className={inputClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {conversation.memberIds.map((id) => (
              <option key={id} value={id}>
                {agents[id]?.name ?? id}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor="routine-kind">Repeat</Label>
        <select id="routine-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="interval">Every N minutes</option>
          <option value="once">Once</option>
        </select>
      </div>
      {(kind === 'daily' || kind === 'weekly') && (
        <div className="flex gap-2">
          {kind === 'weekly' && (
            <select aria-label="Day" className={inputClass} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {DAYS.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <input type="time" aria-label="Time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      )}
      {kind === 'interval' && (
        <input type="number" min={1} aria-label="Minutes" className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      )}
      {kind === 'once' && <input type="datetime-local" aria-label="Date and time" className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} required />}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !title.trim() || !prompt.trim() || !schedule}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function Routines({ conversation }: { conversation: Conversation }) {
  const routines = useStore((s) => s.routines);
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => Object.values(routines).filter((r) => r.conversationId === conversation.id), [routines, conversation.id]);

  return (
    <section aria-label="Routines">
      <SectionTitle
        action={
          <IconButton label="New routine" className="size-7" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            <Plus size={16} />
          </IconButton>
        }
      >
        Routines
      </SectionTitle>
      {adding && <RoutineForm conversation={conversation} onDone={() => setAdding(false)} />}
      <ul>
        {list.map((routine) => (
          <li key={routine.id} className="group flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-hover">
            <Clock size={16} className={`mt-0.5 shrink-0 ${routine.enabled ? 'text-success' : 'text-faint'}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]" title={routine.prompt}>
                {routine.title}
              </p>
              <p className="truncate text-[13px] text-muted">{describeSchedule(routine.schedule)}</p>
            </div>
            <div className="flex items-center gap-0.5">
              <IconButton label="Run now" className="size-7" onClick={() => void runRoutine(routine.id)}>
                <Play size={14} />
              </IconButton>
              <IconButton label="Delete routine" className="size-7" onClick={() => void deleteRoutine(routine.id)}>
                <Trash2 size={14} />
              </IconButton>
              <Switch checked={routine.enabled} label={routine.enabled ? 'Pause routine' : 'Resume routine'} onChange={(enabled) => void patchRoutine(routine.id, { enabled })} />
            </div>
          </li>
        ))}
        {list.length === 0 && !adding && <li className="px-2 py-1 text-[13px] text-muted">None yet</li>}
      </ul>
    </section>
  );
}
