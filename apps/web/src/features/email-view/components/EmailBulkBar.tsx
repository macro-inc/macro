import { TOKENS } from '@core/hotkey/tokens';
import { EntitySelectionToolbarModal } from '@entity/EntitySelectionToolbarModal';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, Hotkey } from '@ui';
import { Match, Switch } from 'solid-js';
import {
  type EmailBulkActionKind,
  type EmailBulkProgress,
  type EmailBulkSelectionState,
  formatConversationCount,
} from '../primitives/bulk-selection';

export type EmailBulkBarProps = {
  state: EmailBulkSelectionState;
  progress?: EmailBulkProgress;
  viewLabel: string;
  onClear: () => void;
  onRetry: () => void;
  onRun: (kind: EmailBulkActionKind) => void;
};

function Busy(props: { text: string }) {
  return (
    <span class="flex items-center gap-2">
      <SpinnerIcon class="size-3.5 animate-spin text-ink-muted" />
      {props.text}
    </span>
  );
}

/** The selection bar for a bulk selection and for the action it is running. */
export function EmailBulkBar(props: EmailBulkBarProps) {
  return (
    <Switch>
      <Match when={props.progress}>
        {(progress) => (
          <EntitySelectionToolbarModal
            label={
              <Busy
                text={`${progress().label}… ${progress().completed.toLocaleString('en-US')} of ${formatConversationCount(progress().total)}`}
              />
            }
          />
        )}
      </Match>
      <Match when={props.state.status === 'resolving' && props.state}>
        {(selection) => (
          <EntitySelectionToolbarModal
            onClose={props.onClear}
            label={
              <Busy
                text={`Selecting… ${formatConversationCount(selection().count)}`}
              />
            }
          />
        )}
      </Match>
      <Match when={props.state.status === 'ready' && props.state}>
        {(selection) => (
          <EntitySelectionToolbarModal
            onClose={props.onClear}
            label={
              selection().scope === 'below'
                ? `All ${formatConversationCount(selection().targets.length)} below selected`
                : `All ${formatConversationCount(selection().targets.length)} in ${props.viewLabel} selected`
            }
          >
            <Button
              variant="outline"
              class="p-1 pl-2 bg-surface"
              depth={3}
              onClick={() => props.onRun('done')}
            >
              <span>Mark done</span>
              <Hotkey token={TOKENS.entity.action.markDone} theme="subtle" />
            </Button>
            <Button
              variant="outline"
              class="p-1 pl-2 bg-surface"
              depth={3}
              onClick={() => props.onRun('read')}
            >
              <span>Mark read</span>
              <Hotkey token={TOKENS.entity.action.markRead} theme="subtle" />
            </Button>
          </EntitySelectionToolbarModal>
        )}
      </Match>
      <Match when={props.state.status === 'failed' && props.state}>
        {(selection) => (
          <EntitySelectionToolbarModal
            onClose={props.onClear}
            label={selection().message}
          >
            <Button
              variant="outline"
              class="p-1 px-2 bg-surface"
              depth={3}
              onClick={props.onRetry}
            >
              Try again
            </Button>
          </EntitySelectionToolbarModal>
        )}
      </Match>
    </Switch>
  );
}
