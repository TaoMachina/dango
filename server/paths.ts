import { homedir } from 'node:os';
import { join } from 'node:path';

// Rea keeps its data outside the repository so reinstalling keeps conversations.
export function hubPaths(home = process.env.REA_HOME ?? join(homedir(), '.rea')) {
  return {
    dir: home,
    db: join(home, 'rea.db'),
    key: join(home, 'key'),
    log: join(home, 'hub.log'),
    hubJson: join(home, 'hub.json'),
  };
}

// A fixed default port keeps the desktop icon and browser bookmarks stable.
// 7420 has no registered IANA service; REA_PORT overrides it when taken.
export function hubPort(): number {
  return Number(process.env.REA_PORT ?? 7420);
}

// Chats without a project run in this folder, so agents never start in a system directory.
export function defaultWorkDir(): string {
  return join(homedir(), 'Rea');
}
