import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { confirmDialog } from '@ui';
import { createMemo, For, getOwner, Match, Show, Switch } from 'solid-js';
import { StackRow } from '../components/stack-row';
import { useNotificationStacksContext } from '../context/notification-stacks-context';
import { draftFromStack, type Stack } from '../core/stack';
import { describeStack } from '../primitives/describe-stack';
import { openStackEditor } from './stack-editor-dialog';

/**
 * The reader's stacks in settings: create one, switch it on or off, edit it,
 * move it up or down the order stacks are tried in, or delete it.
 */
export function StacksSection() {
  const context = useNotificationStacksContext();
  // Dialogs opened from menu handlers still need this subtree's stacks.
  const owner = getOwner();
  const state = context.stacks.state;
  usePending('notification.stacks', () => state().t === 'loading');

  const stacks = createMemo((): readonly Stack[] => {
    const current = state();
    return current.t === 'ready' ? current.stacks : [];
  });
  // Rows are keyed by id: a write replaces every stack object, and a row
  // remounted under an open menu would drop its focus.
  const stackIds = createMemo(() => stacks().map((stack) => stack.id));
  const stackOf = (id: string) => stacks().find((stack) => stack.id === id);

  const write = (change: Promise<void>, failure: string) =>
    fireAndForget(
      (async () => {
        try {
          await change;
        } catch {
          toast.failure(failure);
        }
      })(),
      'notification-stacks'
    );

  const move = (id: string, offset: -1 | 1) => {
    const ids = [...stackIds()];
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    write(context.stacks.reorder(ids), t('notificationStacks.reorderFailed'));
  };

  const remove = async (stack: Stack) => {
    const confirmed = await confirmDialog(
      {
        title: t('notificationStacks.deleteTitle', { name: stack.name }),
        body: t('notificationStacks.deleteBody'),
        confirmLabel: t('notificationStacks.deleteConfirm'),
        tone: 'danger',
      },
      { owner }
    );
    if (!confirmed) return;
    write(
      context.stacks.remove(stack.id),
      t('notificationStacks.deleteFailed')
    );
  };

  const edit = (stack: Stack) => {
    const draft = draftFromStack(stack);
    if (draft) openStackEditor({ stack: { id: stack.id, draft } }, { owner });
  };

  return (
    <SettingsSection
      title={t('notificationStacks.sectionTitle')}
      target="Stacks"
      description={t('notificationStacks.sectionDescription')}
      actions={
        <SettingsButton onClick={() => openStackEditor({}, { owner })}>
          {t('notificationStacks.newStack')}
        </SettingsButton>
      }
    >
      <SettingsCard>
        <Switch>
          <Match when={state().t === 'loading'}>
            <SettingsRow label={t('notificationStacks.loading')} />
          </Match>
          <Match when={state().t === 'error'}>
            <SettingsRow label={t('notificationStacks.loadFailed')}>
              <SettingsButton onClick={() => context.stacks.retry()}>
                {t('notificationStacks.retry')}
              </SettingsButton>
            </SettingsRow>
          </Match>
          <Match when={stackIds().length === 0}>
            <SettingsRow label={t('notificationStacks.empty')} muted />
          </Match>
          <Match when={stackIds().length > 0}>
            <For each={stackIds()}>
              {(id, index) => (
                <Show when={stackOf(id)}>
                  {(stack) => (
                    <StackRow
                      name={stack().name}
                      summary={describeStack(stack())}
                      enabled={stack().enabled}
                      editable={draftFromStack(stack()) !== undefined}
                      canMoveUp={index() > 0}
                      canMoveDown={index() < stackIds().length - 1}
                      onEnabledChange={(enabled) =>
                        write(
                          context.stacks.update(id, { enabled }),
                          t('notificationStacks.updateFailed')
                        )
                      }
                      onEdit={() => edit(stack())}
                      onMoveUp={() => move(id, -1)}
                      onMoveDown={() => move(id, 1)}
                      onDelete={() =>
                        fireAndForget(remove(stack()), 'notification-stacks')
                      }
                    />
                  )}
                </Show>
              )}
            </For>
          </Match>
        </Switch>
      </SettingsCard>
    </SettingsSection>
  );
}
