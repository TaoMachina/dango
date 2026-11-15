export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

export type DiffRow = DiffLine | { kind: 'gap' };

// An LCS table of n*m Uint32 cells. Above 4M cells (16 MB) building it stalls the tab,
// so larger changed blocks are shown as fully removed and re-added.
const MAX_CELLS = 4_000_000;

// Unified diff context, matching the default of `diff -u` and `git diff`.
const CONTEXT = 3;

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  }
  const table = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        a[i] === b[j] ? table[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) {
      out.push({ kind: 'del', text: a[i++] });
    } else {
      out.push({ kind: 'add', text: b[j++] });
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

function lines(text: string) {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/** Line diff with unchanged runs trimmed to CONTEXT lines around each change. */
export function unifiedDiff(oldText: string | null, newText: string): DiffRow[] {
  const a = lines(oldText ?? '');
  const b = lines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const all: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ kind: 'same' as const, text })),
    ...lcsDiff(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => ({ kind: 'same' as const, text })),
  ];
  const keep = all.map(() => false);
  all.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(all.length - 1, index + CONTEXT); k++) keep[k] = true;
  });
  const rows: DiffRow[] = [];
  all.forEach((line, index) => {
    if (keep[index]) rows.push(line);
    else if (rows.length === 0 || rows[rows.length - 1].kind !== 'gap') rows.push({ kind: 'gap' });
  });
  if (rows[rows.length - 1]?.kind === 'gap') rows.pop();
  if (rows[0]?.kind === 'gap') rows.shift();
  return rows;
}
