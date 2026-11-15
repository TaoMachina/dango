import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { Project } from '../../../shared/types.ts';
import { inputClass, Spinner } from '../components/ui.tsx';
import { createProject, pickFolder } from '../lib/actions.ts';

/** Two ways to add a project: pick an existing folder with the system dialog, or name a new one. */
export function NewProjectForm({ onDone }: { onDone: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'pick' | 'create' | null>(null);
  const trimmed = name.trim();

  const choose = () => {
    setBusy('pick');
    void pickFolder()
      .then(async (path) => {
        if (path !== null) onDone(await createProject({ path }));
      })
      .finally(() => setBusy(null));
  };

  return (
    <div className="p-1.5">
      <button
        type="button"
        disabled={busy !== null}
        onClick={choose}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] hover:bg-hover disabled:opacity-60"
      >
        {busy === 'pick' ? <Spinner size={16} className="text-muted" /> : <FolderOpen size={16} className="shrink-0 text-muted" />}
        Choose folder…
      </button>
      <div className="mx-2.5 my-1.5 border-t border-line" />
      <form
        className="px-2.5 pb-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy('create');
          void createProject({ name: trimmed })
            .then(onDone)
            .finally(() => setBusy(null));
        }}
      >
        <label htmlFor="new-project-name" className="mb-1.5 block text-[13px] text-muted">
          New project
        </label>
        <div className="flex gap-2">
          <input id="new-project-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" autoComplete="off" />
          <button
            type="submit"
            disabled={!trimmed || busy !== null}
            className="inline-flex h-9 shrink-0 items-center rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-fg transition hover:opacity-85 disabled:opacity-40"
          >
            Create
          </button>
        </div>
        <p className="mt-1.5 truncate text-[12px] text-muted">Creates ~/Agentry/projects/{trimmed || 'name'}</p>
      </form>
    </div>
  );
}
