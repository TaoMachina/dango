import { NewTask } from './NewTask.tsx';

/** Code with nothing selected: the task box, writing to a new folder unless a project is chosen. */
export function CodeHome() {
  return <NewTask projectId={null} />;
}
