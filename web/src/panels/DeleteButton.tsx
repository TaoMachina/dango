import { Trash2 } from 'lucide-react';
import type { Conversation } from '../../../shared/types.ts';
import { Button } from '../components/ui.tsx';
import { deleteConversation } from '../lib/actions.ts';

export function DeleteButton({ conversation, label }: { conversation: Conversation; label: string }) {
  return (
    <div className="border-t border-line p-3">
      <Button
        variant="danger"
        className="w-full"
        onClick={() => {
          if (confirm(`${label}? Its messages will be removed.`)) void deleteConversation(conversation.id);
        }}
      >
        <Trash2 size={15} /> {label}
      </Button>
    </div>
  );
}
