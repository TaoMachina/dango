import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderPlus, Plus } from 'lucide-react';
import type { ID } from '../../../shared/types.ts';
import { Popover, usePopover } from '../components/Popover.tsx';
import { IconButton, Spinner } from '../components/ui.tsx';
import { openNewThread, select } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';
import { relativeTime } from '../lib/time.ts';
import { NewProjectForm } from './NewProjectForm.tsx';

const COLLAPSED_KEY = 'agentry.code.collapsed';

function readCollapsed(): ID[] {
  return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as ID[];
}

export function CodeList() {
  const projects = useStore((s) => s.projects);
  const conversations = useStore((s) => s.conversations);
  const selected = useStore((s) => s.ui.selected.code);
  const newThreadFor = useStore((s) => s.ui.newThreadProjectId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const add = usePopover();

  const toggle = (id: ID) => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    setCollapsed(next);
  };

  const tree = useMemo(() => {
    const threads = Object.values(conversations)
      // A delegated thread opens from its parent's work log.
      .filter((c) => c.kind === 'code' && !c.parentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Object.values(projects)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) => ({ project, threads: threads.filter((t) => t.projectId === project.id) }));
  }, [projects, conversations]);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h1 className="text-[17px] font-semibold">Code</h1>
        <IconButton ref={add.anchor} label="New project" aria-expanded={add.open !== null} onClick={() => add.setOpen(add.open ? null : 'open')}>
          <FolderPlus size={18} />
        </IconButton>
        {add.open && (
          <Popover anchor={add.anchor} onClose={add.close} label="New project" width={300} align="end">
            <NewProjectForm
              onDone={(project) => {
                add.close();
                openNewThread(project.id);
              }}
            />
          </Popover>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tree.map(({ project, threads }) => {
          const open = !collapsed.includes(project.id);
          return (
            <li key={project.id} className="mb-1">
              <div className={`group flex items-center rounded-xl ${newThreadFor === project.id ? 'bg-selected' : 'hover:bg-hover'}`}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(project.id)}
                  title={project.path}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                >
                  <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
                  <Folder size={16} className="shrink-0 text-muted" />
                  <span className="truncate text-[14px] font-medium">{project.name}</span>
                </button>
                <IconButton
                  label={`New thread in ${project.name}`}
                  className="mr-1 size-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  onClick={() => openNewThread(project.id)}
                >
                  <Plus size={16} />
                </IconButton>
              </div>
              {open && (
                <ul className="ml-[22px] border-l border-line pl-2">
                  {threads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        aria-current={selected === thread.id ? 'true' : undefined}
                        onClick={() => select('code', thread.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${selected === thread.id ? 'bg-selected' : 'hover:bg-hover'}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[14px]">{thread.title}</span>
                        {thread.activeRuns > 0 ? <Spinner size={12} className="text-muted" /> : <span className="shrink-0 text-[12px] text-muted">{relativeTime(thread.updatedAt)}</span>}
                      </button>
                    </li>
                  ))}
                  {threads.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted">No threads yet</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
