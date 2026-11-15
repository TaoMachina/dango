// A small ACP agent for tests. Usage: node fake-agent.ts <name> [mentionTarget] [sessionDelayMs]
// The last line of the prompt selects behavior, so Agentry's context text before it triggers nothing:
//   "tool"       -> reports a tool call with a diff
//   "permission" -> asks for permission and replies with the chosen option id
//   "chain"      -> replies "@<mentionTarget> chain" so the target continues
//   "slow"       -> streams one chunk, waits for cancel, then sends a late chunk
//   "settings"   -> also replies with the session's model and fast values
//   "echo"       -> also replies with the whole prompt on the following lines
// Each finished turn reports usage_update with 100 more tokens used of 1000.
// Every reply starts with "<name> heard: <last line of the prompt>", so group notes are not echoed.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const [name = 'Fake', target = '', delay = '0'] = process.argv.slice(2);
const cancels = new Map<string, () => void>();
const values = new Map<string, Record<string, string | boolean>>();
const turns = new Map<string, number>();
let sessions = 0;

const select = (id: string, category: string, currentValue: string, choices: string[]) =>
  ({ id, name: id, category, type: 'select' as const, currentValue, options: choices.map(value => ({ value, name: value })) });
const configOptions = (v: Record<string, string | boolean>) => [
  select('model', 'model', String(v.model), ['small', 'large']),
  select('mode', 'mode', String(v.mode), ['default', 'read-only']),
  select('effort', 'thought_level', String(v.effort), ['low', 'high']),
  { id: 'fast', name: 'Fast', category: 'speed', type: 'boolean' as const, currentValue: v.fast === true },
];

const app = acp.agent({ name })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } }))
  .onRequest('session/new', async () => {
    await new Promise(resolve => setTimeout(resolve, Number(delay)));
    const sessionId = `${name}-session-${++sessions}`;
    values.set(sessionId, { model: 'small', mode: 'default', effort: 'low', fast: true });
    return { sessionId, configOptions: configOptions(values.get(sessionId)!) };
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const v = values.get(params.sessionId)!;
    v[params.configId] = params.value;
    return { configOptions: configOptions(v) };
  })
  .onNotification('session/cancel', ({ params }) => cancels.get(params.sessionId)?.())
  .onRequest('session/prompt', async ({ params, client }) => {
    const { sessionId } = params;
    const prompt = params.prompt.map(b => (b.type === 'text' ? b.text : '')).join('');
    const text = prompt.trim().split('\n').at(-1)!;
    const say = (chunk: string) => client.notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });

    await say(`${name} heard: ${text}`);
    if (text.includes('echo')) await say(`\n${prompt}`);
    if (text.includes('tool')) {
      await client.notify('session/update', { sessionId, update: {
        sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit file', kind: 'edit', status: 'in_progress',
        content: [{ type: 'diff', path: '/tmp/a.txt', oldText: 'a', newText: 'b' }],
      } });
      await client.notify('session/update', { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' } });
    }
    if (text.includes('permission')) {
      const response = await client.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'p1', title: 'Write file', kind: 'edit', status: 'pending' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
      });
      await say(` chose ${response.outcome.outcome === 'selected' ? response.outcome.optionId : 'cancelled'}`);
    }
    if (text.includes('chain') && target) await say(` @${target} chain`);
    if (text.includes('settings')) await say(` model=${values.get(sessionId)!.model} fast=${values.get(sessionId)!.fast}`);
    if (text.includes('slow')) {
      await new Promise<void>(resolve => cancels.set(sessionId, resolve));
      await say(' late');
      return { stopReason: 'cancelled' as const };
    }
    const turn = (turns.get(sessionId) ?? 0) + 1;
    turns.set(sessionId, turn);
    await client.notify('session/update', { sessionId, update: { sessionUpdate: 'usage_update', used: 100 * turn, size: 1000 } });
    return { stopReason: 'end_turn' as const };
  });

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
