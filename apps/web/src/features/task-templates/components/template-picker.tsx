import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import CopyIcon from '@icon/system/regular/copy.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Button, Dialog, Input, type ManagedDialogProps } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';

/** A template row supplies actions without exposing transport or query state. */
export type TemplatePickerItem = {
  key: string;
  label: string;
  shared: boolean;
  select(): void;
  edit?: () => void;
  remove?: () => void;
};

/** The shared Dialog becomes a drawer on phones. */
export function TemplatePicker(
  props: ManagedDialogProps & {
    items: readonly TemplatePickerItem[];
    loading: boolean;
    error: boolean;
    onRetry(): void;
    onSave(): void;
  }
) {
  const [search, setSearch] = createSignal('');
  const filtered = () => {
    const query = search().trim().toLocaleLowerCase();
    return props.items.filter((item) =>
      item.label.toLocaleLowerCase().includes(query)
    );
  };
  const run = (action: () => void) => {
    props.onOpenChange(false);
    action();
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <div class="flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-1">
          <Dialog.Title class="text-base font-medium">
            {t('create.taskTemplatePickerTitle')}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-ink-muted">
            {t('create.taskTemplatePickerDescription')}
          </Dialog.Description>
        </div>
        <Input
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder={t('create.taskTemplateSearch')}
          aria-label={t('create.taskTemplateSearch')}
        />
        <div class="flex max-h-80 flex-col gap-1 overflow-y-auto">
          <Switch>
            <Match when={props.error}>
              <div class="flex flex-col items-start gap-2 py-3 text-sm">
                <p role="alert" class="text-failure-ink">
                  {t('create.taskTemplateLoadError')}
                </p>
                <Button variant="secondary" size="sm" onClick={props.onRetry}>
                  {t('create.taskTemplateRetry')}
                </Button>
              </div>
            </Match>
            <Match when={props.loading && props.items.length === 0}>
              <div
                role="status"
                class="flex items-center gap-2 py-4 text-sm text-ink-muted"
              >
                <LoadingSpinner class="size-5 p-0" />
                {t('common.loading')}
              </div>
            </Match>
            <Match when={filtered().length === 0}>
              <p class="py-4 text-sm text-ink-muted">
                {props.items.length === 0
                  ? t('create.taskTemplateEmpty')
                  : t('create.taskTemplateNoMatches')}
              </p>
            </Match>
          </Switch>
          <For each={filtered()}>
            {(item) => (
              <div class="flex min-w-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  class="min-w-0 justify-start"
                  onClick={() => run(item.select)}
                  tooltip={item.label}
                >
                  <CopyIcon class="size-4 shrink-0" />
                  <span class="min-w-0 truncate">{item.label}</span>
                  <span class="ml-auto shrink-0 text-xs text-ink-muted">
                    {item.shared
                      ? t('create.taskTemplateTeam')
                      : t('create.taskTemplatePersonal')}
                  </span>
                </Button>
                <Show when={item.edit}>
                  {(edit) => (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('create.taskTemplateEditNamed', {
                        name: item.label,
                      })}
                      onClick={() => run(edit())}
                    >
                      <PencilIcon class="size-4" />
                    </Button>
                  )}
                </Show>
                <Show when={item.remove}>
                  {(remove) => (
                    <Button
                      variant="danger-ghost"
                      size="icon-xs"
                      aria-label={t('create.taskTemplateDeleteNamed', {
                        name: item.label,
                      })}
                      onClick={() => run(remove())}
                    >
                      <TrashIcon class="size-4" />
                    </Button>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="flex justify-end border-t border-edge-muted pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => run(props.onSave)}
          >
            {t('create.taskTemplateSaveCurrent')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
