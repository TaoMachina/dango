import { useMemo } from 'react';
import { unifiedDiff } from '../lib/diff.ts';

const ROW = {
  same: 'text-fg',
  add: 'bg-add-bg text-add',
  del: 'bg-del-bg text-del',
};

const SIGN = { same: ' ', add: '+', del: '-' };

export function DiffView({ path, oldText, newText, showPath = true }: { path: string; oldText: string | null; newText: string; showPath?: boolean }) {
  const rows = useMemo(() => unifiedDiff(oldText, newText), [oldText, newText]);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      {showPath && (
        <div className="truncate border-b border-line px-3 py-1.5 font-mono text-[12px] text-muted" title={path}>
          {path}
          {oldText === null && <span className="ml-2 text-add">new file</span>}
        </div>
      )}
      <pre className="max-h-96 overflow-auto py-1 font-mono text-[12px] leading-5">
        {rows.map((row, index) =>
          row.kind === 'gap' ? (
            <div key={index} className="px-3 text-faint">
              ⋯
            </div>
          ) : (
            <div key={index} className={`min-w-fit px-3 ${ROW[row.kind]}`}>
              <span className="mr-2 select-none opacity-70">{SIGN[row.kind]}</span>
              {row.text || ' '}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
