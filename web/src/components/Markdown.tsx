import { Fragment, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast, type Module } from '../lib/store.ts';
import { select } from '../lib/actions.ts';

// A small Markdown renderer. Input text only ever becomes React text nodes, so raw HTML is escaped.

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'table'; head: string[]; align: ('left' | 'center' | 'right' | undefined)[]; rows: string[][] }
  | { t: 'hr' };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(line: string) {
  return line.match(/^\s*/)![0].replace(/\t/g, '    ').length;
}

function splitRow(line: string) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function startsBlock(line: string) {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || ITEM.test(line);
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end, which keeps streaming code readable.
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      blocks.push({ t: 'quote', blocks: parseBlocks(body.join('\n')) });
      continue;
    }
    const item = line.match(ITEM);
    if (item) {
      const base = indentOf(line);
      const ordered = /\d/.test(item[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const m = current.match(ITEM);
        if (m && indentOf(current) <= base + 1 && /\d/.test(m[2]) === ordered) {
          items.push([m[3]]);
          i++;
          continue;
        }
        if (!current.trim()) {
          const next = lines[i + 1];
          if (next !== undefined && next.trim() && (indentOf(next) > base || (ITEM.test(next) && indentOf(next) <= base + 1))) {
            items[items.length - 1].push('');
            i++;
            continue;
          }
          break;
        }
        if (indentOf(current) > base) {
          items[items.length - 1].push(current.replace(/^\s+/, (ws) => ws.slice(Math.min(ws.length, base + 2))));
          i++;
          continue;
        }
        if (!startsBlock(current) && items[items.length - 1].length > 0 && lines[i - 1].trim()) {
          // Lazy continuation of the item's paragraph.
          items[items.length - 1].push(current.trim());
          i++;
          continue;
        }
        break;
      }
      blocks.push({ t: 'list', ordered, start: ordered ? parseInt(item[2], 10) : 1, items: items.map((body) => parseBlocks(body.join('\n'))) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) =>
        cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined,
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ t: 'table', head, align, rows });
      continue;
    }
    const body: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++]);
    blocks.push({ t: 'p', text: body.join('\n') });
  }
  return blocks;
}

// ---------- Inline ----------

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?!\s)([\s\S]*?[^\s])\*|_(?!\s)([\s\S]*?[^\s])_(?![\p{L}\p{N}])|~~([\s\S]+?)~~|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/u;

function safeHref(url: string) {
  return /^(https?:|mailto:|\?m=(chat|code)&c=)/i.test(url) ? url : null;
}

// The hub links Agentry conversations as `?m=<module>&c=<id>`; open those in place.
function link(href: string, children: ReactNode, key: number) {
  if (href.startsWith('?')) {
    const params = new URLSearchParams(href);
    return (
      <a key={key} href={href} onClick={e => { e.preventDefault(); select(params.get('m') as Module, params.get('c')); }} className="underline decoration-faint underline-offset-2 hover:decoration-fg">
        {children}
      </a>
    );
  }
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-faint underline-offset-2 hover:decoration-fg">
      {children}
    </a>
  );
}

function withBreaks(text: string, key: number) {
  const parts = text.split('\n');
  return (
    <Fragment key={key}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {part}
        </Fragment>
      ))}
    </Fragment>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m || m.index === undefined) {
      out.push(withBreaks(rest, key++));
      break;
    }
    const before = rest.slice(0, m.index);
    // Underscore emphasis only at a word boundary, so snake_case stays plain.
    if (m[6] !== undefined && /[\p{L}\p{N}]$/u.test(before)) {
      out.push(withBreaks(before + '_', key++));
      rest = rest.slice(m.index + 1);
      continue;
    }
    if (before) out.push(withBreaks(before, key++));
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded-md bg-code px-1.5 py-0.5 font-mono text-[0.86em]">
          {m[2].replace(/^ (.*) $/, '$1')}
        </code>,
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={key++} className="font-semibold">{inline(m[3] ?? m[4])}</strong>);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<em key={key++}>{inline(m[5] ?? m[6])}</em>);
    } else if (m[7] !== undefined) {
      out.push(<del key={key++}>{inline(m[7])}</del>);
    } else if (m[8] !== undefined) {
      const href = safeHref(m[9]);
      out.push(href ? link(href, inline(m[8]), key++) : <Fragment key={key++}>{inline(m[8])}</Fragment>);
    } else {
      out.push(link(m[10], m[10], key++));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// ---------- Rendering ----------

export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-bg first:mt-0 last:mb-0">
      <div className="flex h-8 items-center justify-between pl-3 pr-1 text-[12px] text-muted">
        <span>{lang}</span>
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title="Copy"
          onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), (e: Error) => toast(e.message))}
          onBlur={() => setCopied(false)}
          onMouseLeave={() => setCopied(false)}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
        >
          {copied ? <Check size={14} className="animate-pop text-success" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-[13px] leading-5">
        <code>{text}</code>
      </pre>
    </div>
  );
}

const headingClass = ['', 'text-[20px]', 'text-[18px]', 'text-[16px]', 'text-[15px]', 'text-[15px]', 'text-[15px]'];

function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((block, index) => {
    switch (block.t) {
      case 'p':
        return (
          <p key={index} className="my-2 first:mt-0 last:mb-0">
            {inline(block.text)}
          </p>
        );
      case 'h':
        return (
          <p key={index} role="heading" aria-level={block.level} className={`mb-1.5 mt-3 font-semibold first:mt-0 ${headingClass[block.level]}`}>
            {inline(block.text)}
          </p>
        );
      case 'code':
        return <CodeBlock key={index} lang={block.lang} text={block.text} />;
      case 'quote':
        return (
          <blockquote key={index} className="my-2 border-l-2 border-faint pl-3 text-muted first:mt-0 last:mb-0">
            {renderBlocks(block.blocks)}
          </blockquote>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={index}
            start={block.ordered ? block.start : undefined}
            className={`my-2 pl-5 first:mt-0 last:mb-0 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-muted`}
          >
            {block.items.map((item, k) => (
              <li key={k} className="my-0.5 pl-0.5">
                {renderBlocks(item)}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={index} className="my-2 overflow-x-auto first:mt-0 last:mb-0">
            <table className="border-collapse text-[14px]">
              <thead>
                <tr>
                  {block.head.map((cell, k) => (
                    <th key={k} style={{ textAlign: block.align[k] }} className="border-b border-faint px-2.5 py-1.5 text-left font-semibold">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {block.head.map((_, k) => (
                      <td key={k} style={{ textAlign: block.align[k] }} className="border-b border-line px-2.5 py-1.5">
                        {inline(row[k] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={index} className="my-3 border-line" />;
    }
  });
}

export function Markdown({ text }: { text: string }) {
  return <div className="break-words">{renderBlocks(parseBlocks(text))}</div>;
}
