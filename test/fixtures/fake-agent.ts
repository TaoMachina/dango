// A small ACP agent for tests. Usage: node fake-agent.ts <name> [mentionTarget]
// The prompt text selects behavior:
//   "tool"       -> reports a tool call with a diff
//   "permission" -> asks for permission and replies with the chosen option id
//   "chain"      -> replies "@<mentionTarget> chain" so the target continues
//   "slow"       -> streams one chunk, waits for cancel, then sends a late chunk
// Every reply starts with "<name> heard: <last line of the prompt>", so group notes are not echoed.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const [name = 'Fake', target = ''] = process.argv.slice(2);
const cancels = new Map<string, () => void>();
let sessions = 0;

const app = acp.agent({ name })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } }))
  .onRequest('session/new', () => ({
    sessionId: `${name}-session-${++sessions}`,
    configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select' as const, currentValue: 'small', options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }],
  }))
  .onRequest('session/set_config_option', ({ params }) => ({
    configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select' as const, currentValue: String(params.value), options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }],
  }))
  .onNotification('session/cancel', ({ params }) => cancels.get(params.sessionId)?.())
  .onRequest('session/prompt', async ({ params, client }) => {
    const { sessionId } = params;
    const text = params.prompt.map(b => (b.type === 'text' ? b.text : '')).join('');
    const say = (chunk: string) => client.notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });

    await say(`${name} heard: ${text.trim().split('\n').at(-1)}`);
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
    if (text.includes('slow')) {
      await new Promise<void>(resolve => cancels.set(sessionId, resolve));
      await say(' late');
      return { stopReason: 'cancelled' as const };
    }
    return { stopReason: 'end_turn' as const };
  });

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
