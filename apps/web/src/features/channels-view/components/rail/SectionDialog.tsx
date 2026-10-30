import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import HashIcon from '@icon/system/regular/hash.svg';
import { useSmartTagPreviewQuery } from '@queries/channel-labels/channel-labels';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import {
  Button,
  Dialog,
  Input,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  RadioGroup,
  Surface,
} from '@ui';
import { type Accessor, createSignal, For, Show } from 'solid-js';

export type SectionDialogValue = {
  name: string;
  scope: ChannelLabelScopeSelection;
  rule?: ChannelLabelRule;
};

export type SectionDialogProps = {
  scope?: ChannelLabelScopeSelection;
  canShare: boolean;
  initial?: { name: string; rule?: ChannelLabelRule };
  onConfirm: (value: SectionDialogValue) => Promise<void>;
};

function SmartSectionPreview(props: {
  pattern: Accessor<string>;
  scope: ChannelLabelScopeSelection;
}) {
  const preview = useSmartTagPreviewQuery(props.pattern, props.scope);
  const data = () => (preview.isSuccess ? preview.data : undefined);
  const matches = () => data()?.channels ?? [];
  const totalCount = () => data()?.totalCount ?? 0;
  const overflowCount = () => totalCount() - matches().length;

  return (
    <section
      aria-label={t('channelSections.matchedChannels')}
      aria-live="polite"
      class="flex shrink-0 flex-col gap-0.5 text-sm"
    >
      <div class="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-muted">
        <HashIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('channelSections.matchedChannels')}</span>
        <Show when={data()}>
          <span class="tabular-nums">{totalCount()}</span>
        </Show>
      </div>
      <Show
        when={!preview.isPending}
        fallback={
          <p class="px-2 py-2 text-xs text-ink-muted">
            {t('channelSections.matchingChannelsLoading')}
          </p>
        }
      >
        <Show
          when={!preview.isError}
          fallback={
            <div class="flex items-center justify-between gap-2 px-2 py-1 text-xs text-ink-muted">
              <span>{t('channelSections.matchesUnavailable')}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  fireAndForget(preview.refetch(), 'channels-view')
                }
              >
                {t('channelSections.retry')}
              </Button>
            </div>
          }
        >
          <Show
            when={totalCount()}
            fallback={
              <p class="px-2 py-2 text-xs text-ink-muted">
                {t('channelSections.noMatchingChannels')}
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
                {t('channelSections.moreChannelsMatched', {
                  count: overflowCount(),
                })}
              </p>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
}

function SectionDialog(props: SectionDialogProps & ManagedDialogProps) {
  const [name, setName] = createSignal(props.initial?.name ?? '');
  const [scope, setScope] = createSignal<ChannelLabelScopeSelection>(
    props.scope ?? 'personal'
  );
  const [kind, setKind] = createSignal<'manual' | 'smart'>(
    props.initial?.rule ? 'smart' : 'manual'
  );
  const [pattern, setPattern] = createSignal(
    props.initial?.rule?.contains ?? ''
  );
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const trimmedPattern = () => pattern().trim();
  const canSubmit = () =>
    name().trim().length > 0 &&
    (kind() === 'manual' || trimmedPattern().length > 0) &&
    (!props.initial ||
      name().trim() !== props.initial.name.trim() ||
      (kind() === 'smart' &&
        trimmedPattern() !== props.initial.rule?.contains));

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSubmit() || saving()) return;
    setSaving(true);
    setError('');
    try {
      await props.onConfirm({
        name: name().trim(),
        scope: scope(),
        ...(kind() === 'smart'
          ? { rule: { attribute: 'name' as const, contains: trimmedPattern() } }
          : {}),
      });
      props.onOpenChange(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t('channelSections.saveSectionFailed')
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
      class="w-[90%] max-w-100"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[75dvh] flex-col overflow-y-auto rounded-xl text-ink"
      >
        <form
          onSubmit={(event) => fireAndForget(submit(event), 'channels-view')}
          aria-busy={saving()}
        >
          <div class="flex flex-col gap-4 px-5 py-4">
            <div class="flex flex-col gap-1">
              <Dialog.Title class="text-base font-semibold">
                {props.initial
                  ? t('channelSections.editSection')
                  : t('channelSections.newSection')}
              </Dialog.Title>
              <Dialog.Description class="text-sm leading-5 text-ink-muted">
                {t('channelSections.sectionDescription')}
              </Dialog.Description>
            </div>
            <Input
              aria-label={t('channelSections.sectionName')}
              readOnly={saving()}
              onFocus={(event) => event.currentTarget.select()}
              placeholder={t('channelSections.sectionName')}
              value={name()}
              maxLength={80}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <Show when={!props.initial}>
              <RadioGroup
                aria-label={t('channelSections.sectionVisibility')}
                value={scope()}
                onChange={(value) => {
                  if (
                    value === 'personal' ||
                    (value === 'team' && props.canShare)
                  )
                    setScope(value);
                }}
                disabled={saving()}
              >
                <RadioGroup.Item value="personal">
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel>
                    {t('channelSections.personal')}
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
                <Show when={props.canShare}>
                  <RadioGroup.Item value="team">
                    <RadioGroup.ItemControl />
                    <RadioGroup.ItemLabel>
                      {t('channelSections.sharedShort')}
                    </RadioGroup.ItemLabel>
                  </RadioGroup.Item>
                </Show>
              </RadioGroup>
              <RadioGroup
                aria-label={t('channelSections.sectionKind')}
                value={kind()}
                onChange={(value) => {
                  if (value === 'manual' || value === 'smart') setKind(value);
                }}
                disabled={saving()}
              >
                <RadioGroup.Item value="manual">
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel>
                    {t('channelSections.manualSection')}
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
                <RadioGroup.Item value="smart">
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel>
                    {t('channelSections.newSmartSection')}
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
              </RadioGroup>
            </Show>
            <Show when={kind() === 'smart'}>
              <label class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted focus-within:text-ink">
                <span class="shrink-0">
                  {t('channelSections.nameContains')}
                </span>
                <Input
                  variant="bare"
                  class="min-w-40 flex-1 px-0 text-sm"
                  value={pattern()}
                  onInput={(event) => setPattern(event.currentTarget.value)}
                  maxLength={200}
                  placeholder={t('channelSections.patternExample')}
                  readOnly={saving()}
                />
              </label>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
            <Show when={kind() === 'smart' && trimmedPattern().length > 0}>
              <Show when={scope()} keyed>
                {(selectedScope) => (
                  <SmartSectionPreview
                    pattern={trimmedPattern}
                    scope={selectedScope}
                  />
                )}
              </Show>
            </Show>
          </div>
          <div class="flex items-center justify-end gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              disabled={saving()}
              onClick={() => props.onOpenChange(false)}
            >
              {t('channelSections.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit() || saving()}
            >
              {saving()
                ? t('channelSections.saving')
                : props.initial
                  ? t('channelSections.saveSection')
                  : t('channelSections.createSection')}
            </Button>
          </div>
        </form>
      </Surface>
    </Dialog>
  );
}

export async function promptSection(
  props: SectionDialogProps,
  options?: OpenDialogOptions
): Promise<void> {
  const handle = openDialog(SectionDialog, props, options);
  await handle.closed;
}
