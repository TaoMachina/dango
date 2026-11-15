// A Code thread's helpers: the other coding agents its main agent may delegate to, with the model and effort the person chose.
import type { Conversation, ID, SessionOption } from '../shared/types.ts';
import { sessionInfo, stateFrom } from './acp/mapping.ts';
import { HttpError } from './projects.ts';
import type { Store } from './store.ts';

export interface HelperInfo {
  agentId: ID;
  name: string;
  runtime: string;
  enabled: boolean;
  model: string | null; // the chosen model's name; null keeps the helper's own default
  effort: string | null; // the chosen effort's name; null keeps the helper's own default
}

// Rejects a choice the agent does not offer, so a thread never starts with a value its agent cannot apply.
export function checkChoices(offered: SessionOption[], choices: { optionId: string; value: string | boolean }[]) {
  for (const choice of choices) {
    const option = offered.find(o => o.id === choice.optionId);
    const valid = option && (option.type === 'boolean' ? typeof choice.value === 'boolean' : option.choices.some(c => c.value === choice.value));
    if (!valid) throw new HttpError(400, `${JSON.stringify(choice.value)} is not a choice for ${choice.optionId}.`);
  }
}

// Names come from the options the agent reported in its last session.
export function describeHelpers(store: Store, conversation: Conversation): HelperInfo[] {
  return conversation.helpers.flatMap(helper => {
    const agent = store.getAgent(helper.agentId);
    if (!agent) return [];
    const cache = store.getSessionCache(agent.id);
    const offered = sessionInfo({ id: '', kind: 'code' }, agent.id, cache ? { ...cache, usage: null } : stateFrom({}), false).options;
    const chosen = (category: string) => {
      const option = offered.find(o => o.category === category);
      const value = option && helper.options.find(c => c.optionId === option.id)?.value;
      if (option === undefined || value === undefined) return null;
      return option.type === 'select' ? option.choices.find(c => c.value === value)?.name ?? String(value) : String(value);
    };
    return [{
      agentId: agent.id, name: agent.name, runtime: agent.runtimeLabel, enabled: helper.enabled, model: chosen('model'), effort: chosen('thought_level'),
    }];
  });
}
