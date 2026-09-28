import FilterIcon from '@phosphor/funnel-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import XIcon from '@phosphor/x.svg';
import { useSmartTagPreviewQuery } from '@queries/channel-labels/channel-labels';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import {
  Button,
  Dialog,
  Input,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  Surface,
} from '@ui';
import { createSignal, For, Show } from 'solid-js';

export type SmartTagDialogProps = {
  scopeDescription: string;
  initial?: { name: string; rule: ChannelLabelRule };
  onConfirm: (name: string, rule: ChannelLabelRule) => Promise<void>;
};

function SmartTagDialog(props: SmartTagDialogProps & ManagedDialogProps) {
  const [name, setName] = createSignal(props.initial?.name ?? '');
  const [pattern, setPattern] = createSignal(
    props.initial?.rule.contains ?? ''
  );
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const trimmedPattern = () => pattern().trim();
  const preview = useSmartTagPreviewQuery(trimmedPattern);
  const data = () => (preview.isSuccess ? preview.data : undefined);
  const matches = () => data()?.channels ?? [];
  const totalCount = () => data()?.totalCount ?? 0;
  const overflowCount = () => totalCount() - matches().length;
  const canSubmit = () =>
    name().trim().length > 0 &&
    trimmedPattern().length > 0 &&
    (!props.initial ||
      name().trim() !== props.initial.name ||
      trimmedPattern() !== props.initial.rule.contains);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSubmit() || saving()) return;
    setSaving(true);
    setError('');
    try {
      await props.onConfirm(name().trim(), {
        attribute: 'name',
        contains: trimmedPattern(),
      });
      props.onOpenChange(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not save smart label. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!saving()) props.onOpenChange(open);
      }}
    >
      <Surface
        depth={2}
        class="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto rounded-xl bg-dialog p-4 text-ink"
      >
        <form
          class="flex shrink-0 flex-col gap-4"
          onSubmit={(event) => void submit(event)}
          aria-busy={saving()}
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 px-2 text-ink-muted">
              <FilterIcon class="size-4" aria-hidden="true" />
              <Dialog.Title class="text-sm font-medium">
                {props.initial ? 'Edit smart label' : 'New smart label'}
              </Dialog.Title>
            </div>
            <Button
              type="button"
              label="Close"
              size="icon-composer"
              tabIndex={-1}
              disabled={saving()}
              onClick={() => props.onOpenChange(false)}
            >
              <XIcon />
            </Button>
          </div>
          <div class="flex flex-col gap-4 px-2">
            <div class="flex flex-col gap-2">
              <label>
                <span class="sr-only">Label name</span>
                <Input
                  variant="bare"
                  class="h-9 px-0 text-xl/7"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  maxLength={80}
                  placeholder="Smart label name"
                  readOnly={saving()}
                />
              </label>
              <Dialog.Description class="sr-only">
                {props.scopeDescription} Matching team channels are grouped
                automatically by name, ignoring capitalization.
              </Dialog.Description>
            </div>
            <div class="flex flex-col gap-2">
              <label class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted focus-within:text-ink">
                <span class="shrink-0">Name contains</span>
                <Input
                  variant="bare"
                  class="min-w-40 flex-1 px-0 text-sm"
                  value={pattern()}
                  onInput={(event) => setPattern(event.currentTarget.value)}
                  maxLength={200}
                  placeholder="e.g. support"
                  readOnly={saving()}
                />
              </label>
            </div>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
          </div>
          <div class="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              depth={3}
              disabled={saving()}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={canSubmit() ? 'accent' : 'ghost'}
              depth={3}
              class="rounded-lg border-0 not-touch:h-[33.75px] not-touch:rounded-full not-touch:px-[15px]"
              disabled={!canSubmit() || saving()}
            >
              {saving()
                ? 'Saving…'
                : props.initial
                  ? 'Save smart label'
                  : 'Create smart label'}
            </Button>
          </div>
        </form>
        <Show when={trimmedPattern()}>
          <section
            aria-label="Matched channels"
            aria-live="polite"
            class="flex shrink-0 flex-col gap-0.5 text-sm"
          >
            <div class="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-muted">
              <HashIcon class="size-3.5 shrink-0" aria-hidden="true" />
              <span>Matched channels</span>
              <Show when={data()}>
                <span class="tabular-nums">{totalCount()}</span>
              </Show>
            </div>
            <Show
              when={!preview.isPending}
              fallback={
                <p class="px-2 py-2 text-xs text-ink-muted">
                  Matching channels…
                </p>
              }
            >
              <Show
                when={!preview.isError}
                fallback={
                  <div class="flex items-center justify-between gap-2 px-2 py-1 text-xs text-ink-muted">
                    <span>Could not load matches.</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void preview.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                }
              >
                <Show
                  when={totalCount()}
                  fallback={
                    <p class="px-2 py-2 text-xs text-ink-muted">
                      No channels match yet.
                    </p>
                  }
                >
                  <ul class="flex max-h-48 flex-col overflow-y-auto scrollbar-hidden">
                    <For each={matches()}>
                      {(channel) => (
                        <li
                          class="flex min-w-0 items-center gap-2 px-2 py-2"
                          title={channel.name}
                        >
                          <HashIcon
                            class="size-4 shrink-0 text-ink-muted"
                            aria-hidden="true"
                          />
                          <span class="truncate">{channel.name}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={overflowCount() > 0}>
                    <p class="px-2 py-2 text-xs text-ink-muted">
                      +{overflowCount()} more channels matched
                    </p>
                  </Show>
                </Show>
              </Show>
            </Show>
          </section>
        </Show>
      </Surface>
    </Dialog>
  );
}

export async function promptSmartTag(
  props: SmartTagDialogProps,
  options?: OpenDialogOptions
): Promise<void> {
  const handle = openDialog(SmartTagDialog, props, options);
  await handle.closed;
}
