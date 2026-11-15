import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Avatar } from '../components/Avatar.tsx';
import { CopyBox } from '../components/CopyBox.tsx';
import { Button, inputClass, Label, Spinner } from '../components/ui.tsx';
import { connectUrlAgent, inviteAgent, patchAgent, select } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';

// An agent hosted elsewhere cannot reach this computer's hub, so the hub calls the agent's API instead.
function ConnectByUrl({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="connect-by-url"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg py-1 text-left text-[13px] text-muted hover:text-fg focus-visible:outline-2"
      >
        Or connect an agent by URL
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <form
          id="connect-by-url"
          className="mt-2 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void connectUrlAgent({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, model: model.trim() || undefined })
              .then((agent) => {
                onDone();
                select('chat', agent.chatId);
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <div>
            <Label htmlFor="url-agent-url">API URL</Label>
            <input id="url-agent-url" type="url" required className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-agent.example.com/v1" />
          </div>
          <div>
            <Label htmlFor="url-agent-key">API key</Label>
            <input id="url-agent-key" type="password" autoComplete="off" className={inputClass} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="url-agent-model">Model (optional)</Label>
            <input id="url-agent-model" className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <p className="text-[12px] text-muted">Works with agents that offer an OpenAI-compatible API, such as Hermes and OpenClaw.</p>
          {error && (
            <p role="alert" className="break-words text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy || !baseUrl.trim()}>
            {busy && <Spinner />} Connect
          </Button>
        </form>
      )}
    </div>
  );
}

// Opening the form makes an invitation right away: copy, paste into the agent, and it joins under its own name.
export function AddAgentForm({ onDone }: { onDone: () => void }) {
  const agents = useStore((s) => s.agents);
  const [instruction, setInstruction] = useState<string | null>(null);
  const hidden = useMemo(() => Object.values(agents).filter((a) => a.hidden), [agents]);

  useEffect(() => {
    void inviteAgent().then((result) => setInstruction(result.instruction));
  }, []);

  return (
    <div className="p-4">
      <p className="mb-2 text-[14px]">Paste this into your agent. It joins with its own name and says hello.</p>
      {instruction ? <CopyBox text={instruction} /> : <div className="h-[120px] rounded-xl bg-field" aria-busy="true" />}
      <ConnectByUrl onDone={onDone} />
      {hidden.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1 text-[13px] text-muted">Hidden agents</p>
          <ul>
            {hidden.map((agent) => (
              <li key={agent.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar avatar={agent.avatar} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{agent.name}</span>
                <Button className="h-7 px-3 text-[13px]" onClick={() => void patchAgent(agent.id, { hidden: false })}>
                  Show
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
