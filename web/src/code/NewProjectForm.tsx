import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, Folder, HardDrive } from 'lucide-react';
import type { FsListResponse, Project } from '../../../shared/types.ts';
import { Button, inputClass, Spinner } from '../components/ui.tsx';
import { createProject, listFolders } from '../lib/actions.ts';

function separator(path: string) {
  return path.includes('\\') ? '\\' : '/';
}

function crumbs(path: string) {
  const sep = separator(path);
  const out: { name: string; path: string }[] = [];
  let acc = '';
  path
    .split(/[\\/]/)
    .filter(Boolean)
    .forEach((part, index) => {
      if (index === 0) acc = sep === '/' ? `/${part}` : `${part}${sep}`;
      else acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
      out.push({ name: part, path: acc });
    });
  return out;
}

function join(path: string, name: string) {
  const sep = separator(path);
  return path.endsWith(sep) ? path + name : path + sep + name;
}

export function NewProjectForm({ onDone }: { onDone: (project: Project) => void }) {
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (path: string | null) => {
    setLoading(true);
    void listFolders(path)
      .then(setListing)
      .finally(() => setLoading(false));
  };

  useEffect(() => open(null), []);

  const current = listing?.path ?? null;
  const target = current && newName.trim() ? join(current, newName.trim()) : current;

  return (
    <form
      className="flex flex-col p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void createProject(target!)
          .then(onDone)
          .finally(() => setBusy(false));
      }}
    >
      <nav aria-label="Folder path" className="mb-2 flex items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[13px]">
        <button type="button" onClick={() => open(null)} className="rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg">
          Computer
        </button>
        {current &&
          crumbs(current).map((crumb, index, all) => (
            <Fragment key={crumb.path}>
              <ChevronRight size={12} className="shrink-0 text-faint" />
              <button
                type="button"
                onClick={() => open(crumb.path)}
                aria-current={index === all.length - 1 ? 'location' : undefined}
                className={`rounded-md px-1.5 py-0.5 hover:bg-hover ${index === all.length - 1 ? 'font-medium text-fg' : 'text-muted hover:text-fg'}`}
              >
                {crumb.name}
              </button>
            </Fragment>
          ))}
      </nav>
      <div className="h-64 overflow-y-auto rounded-xl border border-line">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted">
            <Spinner size={18} />
          </div>
        ) : listing && listing.entries.length > 0 ? (
          <ul className="p-1">
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => open(entry.path)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] hover:bg-hover"
                >
                  {current ? <Folder size={16} className="shrink-0 text-muted" /> : <HardDrive size={16} className="shrink-0 text-muted" />}
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-3 text-[13px] text-muted">No folders here</p>
        )}
      </div>
      {current && (
        <input
          className={`${inputClass} mt-3`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New folder name (optional)"
          aria-label="New folder name"
        />
      )}
      {target && <p className="mt-2 truncate font-mono text-[12px] text-muted" title={target}>{target}</p>}
      <Button type="submit" variant="primary" className="mt-3" disabled={!target || busy}>
        {newName.trim() ? 'Create and use' : 'Use this folder'}
      </Button>
    </form>
  );
}
