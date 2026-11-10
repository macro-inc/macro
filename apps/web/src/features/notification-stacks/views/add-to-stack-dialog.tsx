import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import {
  Button,
  Checkbox,
  Dialog,
  type ManagedDialogProps,
  Surface,
} from '@ui';
import { createMemo, For, getOwner, Match, Show, Switch } from 'solid-js';
import { useNotificationStacksContext } from '../context/notification-stacks-context';
import {
  capturesChannel,
  captureWithChannel,
  NEW_STACK_DRAFT,
  type Stack,
} from '../core/stack';
import { traceStackWrite } from '../primitives/stack-telemetry';
import { openStackEditor } from './stack-editor-dialog';

/**
 * Choose which of the reader's stacks capture one channel, or start a new
 * stack with it. Each tick is saved at once.
 */
export function AddToStackDialog(
  props: ManagedDialogProps & { channelId: string }
) {
  const context = useNotificationStacksContext();
  const owner = getOwner();
  const state = context.stacks.state;
  const stacks = createMemo((): readonly Stack[] => {
    const current = state();
    return current.t === 'ready' ? current.stacks : [];
  });
  const stackIds = createMemo(() => stacks().map((stack) => stack.id));
  const stackOf = (id: string) => stacks().find((stack) => stack.id === id);

  const setCaptured = async (stack: Stack, captured: boolean) => {
    try {
      await traceStackWrite('notification_stack.capture_channel', (span) => {
        span.setAttr('stack.id', stack.id);
        span.setAttr('channel.id', props.channelId);
        span.setAttr('stack.captured', captured);
        return context.stacks.update(stack.id, {
          capture: captureWithChannel(stack, props.channelId, captured),
        });
      });
    } catch {
      toast.failure(t('notificationStacks.updateFailed'));
    }
  };

  const startNewStack = () =>
    openStackEditor(
      {
        initial: {
          ...NEW_STACK_DRAFT,
          sources: [{ type: 'channel', id: props.channelId }],
        },
      },
      { owner }
    );

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-[min(28rem,90vw)]"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[75dvh] flex-col overflow-y-auto rounded-xl text-ink"
      >
        <div class="flex flex-col gap-4 px-5 py-4">
          <div class="flex flex-col gap-1">
            <Dialog.Title class="text-base font-semibold">
              {t('notificationStacks.addToStackTitle')}
            </Dialog.Title>
            <Dialog.Description class="text-sm leading-5 text-ink-muted">
              {t('notificationStacks.addToStackDescription')}
            </Dialog.Description>
          </div>
          <Switch>
            <Match when={state().t === 'loading'}>
              <p class="text-sm text-ink-muted">
                {t('notificationStacks.loading')}
              </p>
            </Match>
            <Match when={state().t === 'error'}>
              <div class="flex items-center justify-between gap-3">
                <p role="alert" class="text-sm text-failure">
                  {t('notificationStacks.loadFailed')}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => context.stacks.retry()}
                >
                  {t('notificationStacks.retry')}
                </Button>
              </div>
            </Match>
            <Match when={stackIds().length === 0}>
              <p class="text-sm text-ink-muted">
                {t('notificationStacks.addToStackEmpty')}
              </p>
            </Match>
            <Match when={stackIds().length > 0}>
              <div class="flex flex-col">
                <For each={stackIds()}>
                  {(id) => (
                    <Show when={stackOf(id)}>
                      {(stack) => (
                        <Checkbox
                          class="flex w-full items-center gap-2 rounded-lg px-2 py-2 not-touch:hover:bg-hover touch:min-h-11"
                          checked={capturesChannel(stack(), props.channelId)}
                          onChange={(checked) =>
                            fireAndForget(
                              setCaptured(stack(), checked),
                              'notification-stacks'
                            )
                          }
                        >
                          <Checkbox.Control />
                          <Checkbox.Label class="min-w-0 flex-1 truncate text-sm">
                            {stack().name}
                          </Checkbox.Label>
                        </Checkbox>
                      )}
                    </Show>
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <Button
            variant="secondary"
            disabled={state().t !== 'ready'}
            onClick={startNewStack}
          >
            <PlusIcon class="size-4" />
            {t('notificationStacks.newStackForChannel')}
          </Button>
          <Button variant="primary" onClick={() => props.onOpenChange(false)}>
            {t('notificationStacks.done')}
          </Button>
        </div>
      </Surface>
    </Dialog>
  );
}
