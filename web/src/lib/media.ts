import { useSyncExternalStore } from 'react';

// Tailwind's default md (768px) and xl (1280px) breakpoints.
// md: the list column fits beside the conversation. xl: the right panel fits too.
export const WIDE_LIST = '(min-width: 768px)';
export const WIDE_PANEL = '(min-width: 1280px)';

export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
  );
}
