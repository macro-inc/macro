import { t } from '@app/lib/i18n';
import { DeleteDialog } from '@ui';
import { Show } from 'solid-js';

/** Destroys a computer now; enabled only once its exact name is typed. */
export function ReleaseComputerDialog(props: {
  computerName: string;
  /** How many agents releasing deletes, teammates' private ones included. */
  agentCount: number;
  /** The names of the ones the viewer can see. */
  agentNames: readonly string[];
  pending: boolean;
  error?: string;
  onClose: () => void;
  onRelease: () => void;
}) {
  return (
    <DeleteDialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`Release ${props.computerName} now?`}
      deleteLabel="Release now"
      confirmationPhrase={props.computerName}
      pending={props.pending}
      class="w-[min(440px,calc(100vw-16px))] [&_[data-surface]]:h-auto"
      onDelete={props.onRelease}
    >
      <div class="space-y-2">
        <p>
          The computer is destroyed right away and its disk is deleted, with
          everything on it. There is no refund for the rest of this billing
          period.
        </p>
        <Show when={props.agentCount > 0}>
          <p class="font-medium text-ink">
            {t('computers.releaseDeletesAgents', {
              count: props.agentCount,
            })}
            {/* Names only when they are all of them. */}
            <Show
              when={
                props.agentCount <= 3 &&
                props.agentNames.length === props.agentCount
              }
            >
              {': '}
              {props.agentNames.join(', ')}
            </Show>
            .
          </p>
        </Show>
        <p>
          To stop paying without losing it today, cancel at period end instead.
        </p>
        <Show when={props.error}>
          {(error) => (
            <p role="alert" class="text-failure">
              {error()}
            </p>
          )}
        </Show>
      </div>
    </DeleteDialog>
  );
}
