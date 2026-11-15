import { homedir } from 'node:os';
import { join } from 'node:path';

// Agentry keeps its data outside the repository so reinstalling keeps conversations.
export function hubPaths(home = process.env.AGENTRY_HOME ?? join(homedir(), '.agentry')) {
  return {
    dir: home,
    db: join(home, 'agentry.db'),
    key: join(home, 'key'),
    log: join(home, 'hub.log'),
    hubJson: join(home, 'hub.json'),
  };
}

// A fixed default port keeps the desktop icon and browser bookmarks stable.
// 7420 has no registered IANA service; AGENTRY_PORT overrides it when taken.
export function hubPort(): number {
  return Number(process.env.AGENTRY_PORT ?? 7420);
}

// Chats without a project run in this folder, so agents never start in a system directory.
export function defaultWorkDir(): string {
  return join(homedir(), 'Agentry');
}
