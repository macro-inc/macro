import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import HashIcon from '@icon/system/regular/hash.svg';
import QuestionMarkIcon from '@icon/system/regular/question-mark.svg';
import { useSmartTagPreviewQuery } from '@queries/channel-labels/channel-labels';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import {
  Button,
  Dialog,
  HoverCard,
  Input,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  Surface,
  ToggleSwitch,
  Tooltip,
} from '@ui';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';

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
  scope: Accessor<ChannelLabelScopeSelection>;
}) {
  const preview = useSmartTagPreviewQuery(props.pattern, props.scope);
  const data = () => (!preview.isPending ? preview.data : undefined);
  const count = () => data()?.totalCount ?? 0;
  const matches = () => data()?.channels ?? [];
  const overflow = () => count() - matches().length;

  const retry = (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => fireAndForget(preview.refetch(), 'channels-view')}
    >
      {t('channelSections.retry')}
    </Button>
  );

  return (
    <div
      aria-live="polite"
      aria-busy={preview.isFetching}
      class="text-xs text-ink-muted"
    >
      <Switch>
        <Match when={preview.isPending}>
          {t('channelSections.matchingChannelsLoading')}
        </Match>
        <Match when={data()}>
          <HoverCard
            as="button"
            placement="bottom-start"
            triggerAriaLabel={t('channelSections.matchCount', {
              count: count(),
            })}
            triggerClass="underline decoration-dotted underline-offset-4"
            contentClass="block min-w-56 max-w-80"
            content={
              <div>
                <Show
                  when={count() > 0}
                  fallback={
                    <p class="p-2">
                      {props.scope() === 'team'
                        ? t('channelSections.noMatchingTeamChannels')
                        : t('channelSections.noMatchingChannels')}
                    </p>
                  }
                >
                  <ul class="max-h-48 overflow-y-auto">
                    <For each={matches()}>
                      {(channel) => (
                        <li class="flex min-w-0 items-center gap-2 p-2">
                          <HashIcon class="size-3.5 shrink-0" />
                          <Tooltip
                            as="span"
                            class="min-w-0"
                            label={channel.name}
                          >
                            <span class="truncate">{channel.name}</span>
                          </Tooltip>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={overflow() > 0}>
                    <p class="p-2">
                      {t('channelSections.moreChannelsMatched', {
                        count: overflow(),
                      })}
                    </p>
                  </Show>
                </Show>
              </div>
            }
          >
            {t('channelSections.matchCount', { count: count() })}
          </HoverCard>
          <Show when={preview.isError}>
            <span class="ml-2">{t('channelSections.matchesUnavailable')}</span>
            {retry}
          </Show>
        </Match>
        <Match when={preview.isError}>
          <div class="flex items-center gap-2">
            {t('channelSections.matchesUnavailable')}
            {retry}
          </div>
        </Match>
      </Switch>
    </div>
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
  const [sharingHelpOpen, setSharingHelpOpen] = createSignal(false);
  const sharingHelpId = createUniqueId();

  const trimmedPattern = () => pattern().trim();
  const canSubmit = () => {
    if (name().trim().length === 0) {
      return false;
    }

    if (kind() !== 'manual' && trimmedPattern().length === 0) {
      return false;
    }

    if (!props.initial || name().trim() !== props.initial.name.trim()) {
      return true;
    }

    return (
      kind() === 'smart' && trimmedPattern() !== props.initial.rule?.contains
    );
  };

  const submitLabel = () => {
    if (saving()) {
      return t('channelSections.saving');
    }

    return props.initial
      ? t('channelSections.saveSection')
      : t('channelSections.createSection');
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (!canSubmit() || saving()) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const value: SectionDialogValue = {
        name: name().trim(),
        scope: scope(),
      };

      if (kind() === 'smart') {
        value.rule = { attribute: 'name', contains: trimmedPattern() };
      }

      await props.onConfirm(value);
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
        if (!saving()) {
          props.onOpenChange(open);
        }
      }}
      class="w-[min(36rem,90vw)]"
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
              <ToggleSwitch
                label={t('channelSections.newSmartSection')}
                labelClass="text-sm text-ink"
                checked={kind() === 'smart'}
                onChange={(checked) => setKind(checked ? 'smart' : 'manual')}
                disabled={saving()}
              />
            </Show>
            <Show when={kind() === 'smart'}>
              <label class="flex flex-col gap-2 text-sm text-ink-muted">
                <span>{t('channelSections.nameContains')}</span>
                <Input
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
              <SmartSectionPreview pattern={trimmedPattern} scope={scope} />
            </Show>
            <Show when={scope() === 'team'}>
              <p class="text-xs leading-5 text-warning">
                {t('channelSections.teamChannelsOnly')}
              </p>
            </Show>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3 px-5 py-3">
            <Show when={!props.initial && props.canShare}>
              <div class="mr-auto flex shrink-0 items-center gap-1">
                <ToggleSwitch
                  label={t('channelSections.shared')}
                  labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
                  checked={scope() === 'team'}
                  onChange={(checked) =>
                    setScope(checked ? 'team' : 'personal')
                  }
                  disabled={saving()}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('channelSections.sharingHelpLabel')}
                  aria-expanded={sharingHelpOpen()}
                  aria-controls={sharingHelpId}
                  onClick={() => setSharingHelpOpen((open) => !open)}
                  tooltip={{
                    content: t('channelSections.sharingHelp'),
                    disabled: sharingHelpOpen(),
                  }}
                >
                  <QuestionMarkIcon class="size-3.5" />
                </Button>
              </div>
            </Show>
            <div class="ml-auto flex shrink-0 items-center gap-2">
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
                {submitLabel()}
              </Button>
            </div>
            <Show when={sharingHelpOpen()}>
              <p
                id={sharingHelpId}
                class="w-full text-xs leading-5 text-ink-muted"
              >
                {t('channelSections.sharingHelp')}
              </p>
            </Show>
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
