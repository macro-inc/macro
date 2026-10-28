import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { MessageOperationSource } from '../context/message-operation-source';
import {
  type MessageOperation,
  type MessageResolutionAction,
  operationActions,
  operationDescription,
} from '../core/message-operation';

const labels: Record<MessageResolutionAction, string> = {
  keep_local: 'Keep Macro version',
  use_provider: 'Use mailbox version',
  recheck: 'Check again',
  retry_send: 'Retry send',
  keep_original: 'Keep original copy and continue',
};

export function MessageOperationRecovery(props: {
  source: MessageOperationSource;
  onReloadDraft?: () => void;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [decision, setDecision] = createSignal<{
    action: MessageResolutionAction;
    operation: MessageOperation;
  }>();
  const [accepted, setAccepted] = createSignal(false);
  const execute = async (
    action: MessageResolutionAction,
    operation: MessageOperation
  ) => {
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      await props.source.resolve(operation, action, accepted());
      setDecision(undefined);
      setAccepted(false);
    } catch {
      setError(
        'The operation could not be completed. Refresh this draft and try again.'
      );
    } finally {
      setPending(false);
    }
  };
  const reloadReady = (operation: MessageOperation) =>
    !!props.source.needsReload?.() && operation.state === 'SYNCHRONIZED';
  const visibleOperation = () => {
    const operation = props.source.operation();
    if (!operation) return undefined;
    const visible =
      !!operationDescription(operation) ||
      reloadReady(operation) ||
      !!decision() ||
      !!error();
    return visible ? operation : undefined;
  };
  return (
    <Show when={visibleOperation()}>
      {(operation) => (
        <div
          class="border-b border-edge-muted p-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <Show when={operationDescription(operation())}>
            {(description) => <p>{description()}</p>}
          </Show>
          <Show when={reloadReady(operation())}>
            <p>
              The mailbox version is ready. Reload the draft to continue
              editing.
            </p>
            <Show when={props.onReloadDraft}>
              <Button size="sm" variant="outline" onClick={props.onReloadDraft}>
                Reload draft
              </Button>
            </Show>
          </Show>
          <Show when={error()}>
            {(message) => (
              <p class="text-failure" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show
            when={!decision()}
            fallback={
              <div class="mt-2 flex flex-col gap-2">
                <p>
                  {decision()?.action === 'keep_original'
                    ? 'Keep the original copy in its mailbox and enable sending this copy? Review the original and Sent mail before continuing.'
                    : decision()?.action === 'retry_send'
                      ? 'Send this email again? The earlier attempt may already have reached its recipients.'
                      : decision()?.action === 'use_provider'
                        ? 'Replace the saved Macro draft with the mailbox version?'
                        : 'Replace the mailbox draft with the saved Macro version?'}
                </p>
                <Show
                  when={
                    decision()?.action === 'retry_send' ||
                    decision()?.action === 'keep_original'
                  }
                >
                  <label class="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={accepted()}
                      onChange={(event) =>
                        setAccepted(event.currentTarget.checked)
                      }
                    />
                    {decision()?.action === 'keep_original'
                      ? 'I have reviewed the original copy and understand that sending either copy may deliver a duplicate.'
                      : 'I understand this may send a duplicate email.'}
                  </label>
                </Show>
                <div class="flex gap-2">
                  <Button
                    size="sm"
                    variant="strong"
                    disabled={
                      pending() ||
                      ((decision()?.action === 'retry_send' ||
                        decision()?.action === 'keep_original') &&
                        !accepted())
                    }
                    onClick={() =>
                      fireAndForget(
                        execute(decision()!.action, decision()!.operation),
                        'message-operation-recovery'
                      )
                    }
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending()}
                    onClick={() => {
                      setDecision(undefined);
                      setAccepted(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            }
          >
            <div class="mt-2 flex flex-wrap gap-2">
              <For each={operationActions(operation())}>
                {(action) => (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending()}
                    onClick={() => {
                      if (
                        action === 'recheck' ||
                        (action === 'retry_send' &&
                          operation().issue === 'SEND_REJECTED')
                      )
                        fireAndForget(
                          execute(action, operation()),
                          'message-operation-recovery'
                        );
                      else setDecision({ action, operation: operation() });
                    }}
                  >
                    {pending() ? 'Working…' : labels[action]}
                  </Button>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
