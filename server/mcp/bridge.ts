// Dango tools as an MCP stdio server. Each agent session starts its own copy with
// DANGO_URL and DANGO_TOOL_TOKEN; every tool call is forwarded to the hub's /tool-api.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scheduleSchema } from '../routines.ts';

const url = process.env.DANGO_URL!;
const token = process.env.DANGO_TOOL_TOKEN!;

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const response = await fetch(`${url}/tool-api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { content: [{ type: 'text' as const, text }], isError: !response.ok };
}

const server = new McpServer({ name: 'dango', version: '0.2.0' });

server.registerTool('dango_conversation', {
  description: 'Describe the current Dango conversation: its kind, title, you, the lead and every member with name and runtime.',
}, () => call('GET', 'conversation'));

server.registerTool('dango_list_projects', {
  description: 'List the project folders Dango knows (id, name, absolute path), each with its Code threads (id, title, last activity, status).',
}, () => call('GET', 'projects'));

server.registerTool('dango_start_code_task', {
  description: 'Start a coding task in a project as a new Dango Code thread. The prompt is posted there as coming from you. Returns the new conversation id.',
  inputSchema: {
    project: z.string().describe('Project id, project name, or an absolute folder path (a new project is created for a new path).'),
    agent: z.string().optional().describe('Agent name or id to do the work. Defaults to you.'),
    prompt: z.string().describe('What the agent should do.'),
    title: z.string().optional().describe('Short title for the Code thread.'),
  },
}, args => call('POST', 'code-task', args));

server.registerTool('dango_read_code_thread', {
  description: 'Read a Code thread: its project, agent, status (running, done, error or stopped) and latest messages, with tool calls summarized as one line each.',
  inputSchema: { conversation: z.string().describe('The Code thread id or title.') },
}, args => call('POST', 'code-thread', args));

server.registerTool('dango_list_helpers', {
  description: 'List the helpers of this Code thread: other coding agents you may delegate to, each with its runtime, whether the person enabled it, and its chosen model and effort (null: its own default).',
}, () => call('GET', 'helpers'));

server.registerTool('dango_delegate', {
  description: 'Hand part of the work to an enabled helper agent of this Code thread. Dango starts the helper in a new thread in the same project folder ' +
    'with the model and effort the person chose, and waits for its answer. The helper does not see this conversation, so give complete instructions. ' +
    'Returns {status, result, thread} when the helper finishes in time. If it is still working, returns {status: "running", delegationId}: ' +
    'call dango_wait_for_helper with that delegationId until it finishes. Check the helper\'s work before relying on it.',
  inputSchema: {
    helper: z.string().describe('The helper\'s name, as dango_list_helpers shows it.'),
    task: z.string().describe('Complete instructions for the helper.'),
    title: z.string().optional().describe('Short title for the helper\'s thread. Defaults to the first line of the task.'),
  },
}, args => call('POST', 'delegate', args));

server.registerTool('dango_wait_for_helper', {
  description: 'Keep waiting for a helper that dango_delegate reported as running. Returns {status, result, thread} once it finishes, ' +
    'or {status: "running", delegationId} again: then call this tool again.',
  inputSchema: { delegationId: z.string().describe('The delegationId dango_delegate returned.') },
}, args => call('POST', 'wait-for-helper', args));

server.registerTool('dango_create_routine', {
  description: 'Schedule a routine in the current conversation. When it fires, you receive the prompt here. Times are local. ' +
    'schedule: {kind:"daily",time:"HH:MM"} | {kind:"weekly",day:0-6 (0=Sunday),time:"HH:MM"} | {kind:"interval",minutes} | {kind:"once",at:ISO date-time}.',
  inputSchema: { title: z.string(), prompt: z.string(), schedule: scheduleSchema },
}, args => call('POST', 'routines', args));

server.registerTool('dango_send_message', {
  description: 'Post a message into the current conversation as you, outside your current reply. It starts no new work.',
  inputSchema: { text: z.string() },
}, args => call('POST', 'messages', args));

await server.connect(new StdioServerTransport());
