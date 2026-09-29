import { MessageThread } from '@core/messages/MessageThread';
import type { MessageData } from '@core/messages/types';
import type { MessageListItem } from '@service-storage/messages';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';

export function SpreadsheetCommentThread(props: {
  data: MessageListItem;
  canWrite: boolean;
  targetId: string | null;
  onClearTarget: () => void;
  buildLink: (message: MessageData) => string;
  onResolve: (resolved: boolean) => void;
}) {
  return (
    <div class="mb-3">
      <MessageThread
        data={props.data}
        canWrite={props.canWrite}
        targetId={props.targetId}
        onClearTarget={props.onClearTarget}
        buildLink={props.buildLink}
        expanded
        monorail
      />
      <div class="mt-1 flex items-center justify-end gap-2 text-xs">
        <Show when={props.data.state.resolved}>
          <span class="text-success">Resolved</span>
        </Show>
        <Show when={props.canWrite}>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onResolve(!props.data.state.resolved)}
          >
            {props.data.state.resolved ? 'Reopen' : 'Resolve'}
          </Button>
        </Show>
      </div>
    </div>
  );
}
