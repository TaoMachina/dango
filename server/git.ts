import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The branch checked out in `folder`, or null when the folder is not in a git repository or git is not installed.
export async function gitBranch(folder: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'rev-parse', '--abbrev-ref', 'HEAD'], { windowsHide: true });
    return stdout.trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') return null;
    if (/not a git repository/i.test(failure.stderr ?? '')) return null;
    console.error(`git could not read the branch in ${folder}: ${failure.stderr?.trim() || failure.message}`);
    return null;
  }
}
