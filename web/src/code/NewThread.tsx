import type { ID } from '../../../shared/types.ts';
import { NewTask } from './NewTask.tsx';

/** A new code thread in a chosen project. */
export function NewThread({ projectId }: { projectId: ID }) {
  return <NewTask projectId={projectId} />;
}
