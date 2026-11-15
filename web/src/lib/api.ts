import { setState, toast } from './store.ts';

/** Dev only: `?fixture=1` serves sample data from web/src/dev/fixture.ts instead of the hub. */
export const fixtureMode = import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');

async function send(path: string, init: RequestInit): Promise<Response> {
  if (import.meta.env.DEV && fixtureMode) {
    const { fixtureFetch } = await import('../dev/fixture.ts');
    return fixtureFetch(path, init);
  }
  return fetch(path, init);
}

/** `quiet` leaves the error to the caller (for example a form that shows it inline) instead of a toast. */
export async function api<T>(method: string, path: string, body?: unknown, quiet = false): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await send(path, init);
  if (res.status === 401) {
    setState(() => ({ auth: 'unauthorized' }));
    throw new Error('Not signed in');
  }
  const json = res.headers.get('content-type')?.includes('application/json');
  if (!res.ok) {
    const message = json ? ((await res.json()) as { error: string }).error : `${res.status} ${res.statusText}`;
    if (!quiet) toast(message);
    throw new Error(message);
  }
  return (json ? await res.json() : {}) as T;
}
