import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from '../lib/store.ts';
import { Button } from './ui.tsx';

/** Read-only text with a Copy button that confirms with a green check. */
export function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <textarea
        readOnly
        value={text}
        rows={6}
        aria-label="Invitation"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-lg border border-line bg-field px-3 py-2 font-mono [overflow-wrap:anywhere] text-[12px] leading-5 text-fg focus:outline-none focus-visible:outline-2"
      />
      <Button variant="primary" className="mt-2 w-full" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), (e: Error) => toast(e.message))}>
        {copied ? (
          <>
            <Check size={16} className="animate-pop text-success" /> Copied
          </>
        ) : (
          <>
            <Copy size={16} /> Copy
          </>
        )}
      </Button>
    </div>
  );
}
