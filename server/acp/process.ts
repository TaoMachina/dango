// One agent process speaking ACP over its stdio.
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { resolveLaunch, type CatalogEntry } from '../agents/catalog.ts';

export interface ProcessHandlers {
  onUpdate(notification: acp.SessionNotification): void;
  onPermission(request: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse>;
  onExit(detail: string | null): void;
}

// The end of stderr usually holds the reason a process failed; 4 KB keeps a typical stack trace head.
const STDERR_TAIL_BYTES = 4096;

export class AgentProcess {
  child: ChildProcess;
  connection: acp.ClientConnection;
  init: acp.InitializeResponse | null = null;
  exited: Promise<void>;
  private stderrTail = '';
  private stopping = false;

  // env: settings the person chose for this agent that its runtime reads at start, such as its subagent model.
  constructor(entry: CatalogEntry, handlers: ProcessHandlers, env: Record<string, string> = {}) {
    const launch = resolveLaunch(entry.launch());
    this.child = spawn(launch.command, launch.args, {
      shell: launch.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...launch.env, ...env },
    });
    this.child.stderr!.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });

    const app = acp.client({ name: 'agentry' })
      .onNotification('session/update', ({ params }) => handlers.onUpdate(params))
      .onRequest('session/request_permission', ({ params, signal }) => handlers.onPermission(params, signal));
    this.connection = app.connect(acp.ndJsonStream(
      Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>,
    ));

    this.exited = new Promise(resolve => {
      // Node may emit both 'error' and 'exit' for one failed process.
      let ended = false;
      const finish = (detail: string | null) => {
        if (ended) return;
        ended = true;
        this.connection.close(new Error(detail ?? `${entry.runtimeLabel} stopped.`));
        handlers.onExit(this.stopping ? null : detail);
        resolve();
      };
      this.child.on('error', error => finish(`${entry.runtimeLabel} could not start: ${error.message}`));
      this.child.on('exit', code => finish(code === 0 ? null : `${entry.runtimeLabel} exited with code ${code}. ${this.lastStderrLine()}`.trim()));
    });
  }

  async initialize(): Promise<acp.InitializeResponse> {
    this.init = await this.connection.agent.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      // Agents use their own file and terminal tools, so Agentry offers neither.
      // subagents: the agent reports each subagent it starts and streams the subagent's own session updates.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, subagents: {} },
      clientInfo: { name: 'agentry', version: '0.2.0' },
    });
    return this.init;
  }

  lastStderrLine(): string {
    return this.stderrTail.trim().split(/\r?\n/).at(-1) ?? '';
  }

  stop(): Promise<void> {
    this.stopping = true;
    this.connection.close();
    // A shell-started agent is a process tree on Windows; taskkill /T ends the whole tree.
    if (process.platform === 'win32' && this.child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      this.child.kill();
    }
    return this.exited;
  }
}
