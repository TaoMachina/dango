import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Folder, FolderOpen, FolderPlus } from 'lucide-react';
import type { Agent, ID, SessionOption } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { MenuToggle } from '../components/MenuToggle.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { MenuItem } from '../components/ui.tsx';
import { ComposerBox } from '../conversation/ComposerBox.tsx';
import { current, EffortSlider, effortLabel, isSelect, ModelList, ModePicker, pillClass, shortModel, type Select, type SetOption } from '../conversation/SessionPickers.tsx';
import { createConversation, createProject, loadAgentOptions, pickFolder, select, sendMessage } from '../lib/actions.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';

type Overrides = Record<ID, Record<string, string | boolean>>;

const LAST_AGENT = 'agentry.code.agent';

function readLastAgent(): string | null {
  // Storage can be unavailable (private windows); the first agent is then the default.
  try {
    return localStorage.getItem(LAST_AGENT);
  } catch {
    return null;
  }
}

function withOverrides(options: SessionOption[], chosen: Record<string, string | boolean> | undefined): SessionOption[] {
  if (!chosen) return options;
  return options.map((o) => (o.id in chosen ? ({ ...o, currentValue: chosen[o.id] } as SessionOption) : o));
}

/**
 * Starts Code work the way T3 Code does: write the task, pick the model (which picks the agent), its effort,
 * its access mode and the project, then send. Without a project the hub makes a new folder for the task.
 */
export function NewTask({ projectId }: { projectId: ID | null }) {
  const agents = useStore((s) => s.agents);
  const projects = useStore((s) => s.projects);
  const agentOptions = useStore((s) => s.agentOptions);
  const wide = useMedia(WIDE_LIST);
  const coders = useMemo(() => Object.values(agents).filter((a) => a.source === 'acp' && !a.hidden), [agents]);
  const [agentId, setAgentId] = useState<ID | null>(() => {
    const last = readLastAgent();
    return coders.find((a) => a.id === last)?.id ?? coders[0]?.id ?? null;
  });
  const [overrides, setOverrides] = useState<Overrides>({});
  const [project, setProject] = useState<ID | null>(projectId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // The hub owns each agent's options; ask for them so the picker can show every agent's models.
  const coderKey = coders.map((a) => a.id).join(',');
  useEffect(() => {
    for (const a of coders) void loadAgentOptions(a.id);
  }, [coderKey]);
  useEffect(() => setProject(projectId), [projectId]);

  const agent = agentId ? agents[agentId] : undefined;
  const options = agentId ? withOverrides(agentOptions[agentId]?.options ?? [], overrides[agentId]) : [];
  const mode = options.find((o) => isSelect(o, 'mode')) as Select | undefined;

  const choose = (forAgent: ID): SetOption => (id, value) => {
    setAgentId(forAgent);
    setOverrides((o) => ({ ...o, [forAgent]: { ...o[forAgent], [id]: value } }));
  };

  const submit = () => {
    if (!agentId) return;
    const prompt = text.trim();
    // The first line names the thread; 60 characters fit a sidebar row.
    const title = prompt.split('\n')[0].slice(0, 60);
    const chosen = Object.entries(overrides[agentId] ?? {}).map(([optionId, value]) => ({ optionId, value }));
    setBusy(true);
    try {
      localStorage.setItem(LAST_AGENT, agentId);
    } catch {
      // Remembering the agent is a convenience; the thread still starts.
    }
    void createConversation({ kind: 'code', projectId: project, agentId, title, options: chosen })
      .then(async (conversation) => {
        select('code', conversation.id);
        await sendMessage(conversation.id, prompt, []);
      })
      .finally(() => setBusy(false));
  };

  const projectName = project ? projects[project]?.name : null;

  return (
    <div className="flex h-full flex-col">
      {!wide && (
        <div className="flex h-14 items-center px-3">
          <MenuToggle />
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
        <h2 className="mb-6 text-center text-[22px] font-semibold">{projectName ? `What should we build in ${projectName}?` : 'What should we build?'}</h2>
        <div className="w-full max-w-2xl">
          <ComposerBox value={text} onChange={setText} onSubmit={submit} placeholder="Describe the task" autoFocus busy={busy || !agent} />
          {/* 7px matches the composer's border and padding, like the session controls in conversations. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-0.5 px-[7px]">
            <ProjectPicker project={project} onChange={setProject} />
            {agent ? <ModelPicker agent={agent} coders={coders} overrides={overrides} choose={choose} /> : <span className="px-2.5 text-[13px] text-muted">No coding agents found on this computer</span>}
            {mode && agentId && <ModePicker mode={mode} set={choose(agentId)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectPicker({ project, onChange }: { project: ID | null; onChange: (id: ID | null) => void }) {
  const projects = useStore((s) => s.projects);
  const pop = usePopover();
  const list = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));
  const name = project ? (projects[project]?.name ?? 'Project') : 'New folder';

  return (
    <>
      <button ref={pop.anchor} type="button" aria-label={`Project: ${name}`} aria-expanded={pop.open !== null} onClick={() => pop.setOpen(pop.open ? null : 'open')} className={pillClass}>
        {project ? <Folder size={13} className="shrink-0" /> : <FolderPlus size={13} className="shrink-0" />}
        <span className="truncate">{name}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Project" width={300}>
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            <MenuItem
              active={project === null}
              icon={<FolderPlus size={15} className="text-muted" />}
              onClick={() => {
                onChange(null);
                pop.close();
              }}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block">New folder</span>
                  <span className="block text-[12px] text-muted">In ~/Agentry/projects, named after the task</span>
                </span>
                {project === null && <Check size={14} />}
              </span>
            </MenuItem>
            {list.length > 0 && <div className="my-1 border-t border-line" />}
            {list.map((p) => (
              <MenuItem
                key={p.id}
                active={p.id === project}
                icon={<Folder size={15} className="text-muted" />}
                onClick={() => {
                  onChange(p.id);
                  pop.close();
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate text-[12px] text-muted">{p.path}</span>
                  </span>
                  {p.id === project && <Check size={14} />}
                </span>
              </MenuItem>
            ))}
            <div className="my-1 border-t border-line" />
            <MenuItem
              icon={<FolderOpen size={15} className="text-muted" />}
              onClick={() => {
                pop.close();
                void pickFolder().then(async (path) => {
                  if (path) onChange((await createProject({ path })).id);
                });
              }}
            >
              Choose folder…
            </MenuItem>
          </div>
        </Popover>
      )}
    </>
  );
}

/** One picker for every agent's models, like T3 Code: agents down the left, the chosen agent's models and effort on the right. */
function ModelPicker(props: { agent: Agent; coders: Agent[]; overrides: Overrides; choose: (agentId: ID) => SetOption }) {
  const { agent, coders, overrides, choose } = props;
  const agentOptions = useStore((s) => s.agentOptions);
  const pop = usePopover();
  const [viewing, setViewing] = useState<ID>(agent.id);
  const optionsOf = (id: ID) => withOverrides(agentOptions[id]?.options ?? [], overrides[id]);

  const own = optionsOf(agent.id);
  const model = own.find((o) => isSelect(o, 'model')) as Select | undefined;
  const effort = own.find((o) => isSelect(o, 'thought_level')) as Select | undefined;
  const modelName = model && shortModel(current(model)?.name ?? model.currentValue);
  const effortChoice = effort && current(effort);
  const summary = [modelName ?? agent.name, effortChoice && effortLabel(effortChoice)].filter(Boolean).join(' · ');

  const shown = viewedAgent(coders, viewing);
  const viewed = optionsOf(shown.id);
  const viewedModel = viewed.find((o) => isSelect(o, 'model')) as Select | undefined;
  const viewedEffort = viewed.find((o) => isSelect(o, 'thought_level')) as Select | undefined;
  const loaded = agentOptions[shown.id];

  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        aria-label={`Model: ${summary}`}
        aria-expanded={pop.open !== null}
        onClick={() => {
          setViewing(agent.id);
          pop.setOpen(pop.open ? null : 'open');
        }}
        className={`${pillClass} pl-1.5`}
      >
        <Avatar avatar={agent.avatar} size={16} />
        <span className="truncate">{summary}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Model" width={380}>
          <div className="flex">
            <div role="tablist" aria-label="Agents" aria-orientation="vertical" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-sidebar py-1.5">
              {coders.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === shown.id}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => setViewing(c.id)}
                  className={`relative flex size-9 items-center justify-center rounded-lg transition-colors ${c.id === shown.id ? 'bg-selected' : 'hover:bg-hover'}`}
                >
                  <Avatar avatar={c.avatar} size={24} />
                  {c.id === agent.id && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-fg ring-2 ring-sidebar" aria-hidden="true" />}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="px-3 pt-2.5 text-[12px] text-muted">{shown.name}</p>
              {viewedModel ? (
                <ModelList model={viewedModel} set={choose(shown.id)} />
              ) : (
                <p className="px-3 py-4 text-[13px] text-muted">
                  {shown.status === 'needs-auth' || shown.status === 'error' ? shown.statusDetail : loaded?.ready === false ? `Starting ${shown.name}…` : 'This agent reports no model choices.'}
                </p>
              )}
              {viewedEffort && (
                <div className="border-t border-line px-3 pb-3 pt-2.5">
                  <EffortSlider option={viewedEffort} onPick={(value) => choose(shown.id)(viewedEffort.id, value)} />
                </div>
              )}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

// Falls back to the first agent when the viewed one was hidden while the picker was open.
function viewedAgent(coders: Agent[], viewing: ID): Agent {
  return coders.find((c) => c.id === viewing) ?? coders[0];
}
