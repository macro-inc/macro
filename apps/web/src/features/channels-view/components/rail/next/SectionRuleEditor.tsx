import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import HashIcon from '@icon/system/regular/hash.svg';
import { useSmartTagPreviewQuery } from '@queries/channel-labels/channel-labels';
import { queryReadyGate } from '@queries/gate';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import { Button, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';

export function SectionRuleEditor(props: {
  label: ChannelLabel;
  onSave: (rule: ChannelLabelRule) => Promise<void>;
  onClose: () => void;
}) {
  const [pattern, setPattern] = createSignal(props.label.rule?.contains ?? '');
  const preview = useSmartTagPreviewQuery(pattern, () =>
    props.label.teamId ? 'team' : 'personal'
  );
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const replacesPickedChannels = () =>
    !props.label.rule && props.label.channelCount > 0;
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (saving() || !pattern().trim()) return;
    setSaving(true);
    const result = await catchToResult(() =>
      props.onSave({ attribute: 'name', contains: pattern().trim() })
    );
    if (result.isErr()) {
      setSaving(false);
      setError(t('channelSections.saveSectionFailed'));
      return;
    }
    props.onClose();
  };
  return (
    <form
      class="flex min-h-0 flex-col gap-3 p-3"
      onSubmit={(event) => fireAndForget(save(event), 'channels-view')}
    >
      <label class="flex flex-col gap-2 text-sm">
        {t('channelSections.nameContains')}
        <Input
          value={pattern()}
          onInput={(event) => setPattern(event.currentTarget.value)}
          readOnly={saving()}
          maxLength={200}
          placeholder={t('channelSections.patternExample')}
        />
      </label>
      <Show when={replacesPickedChannels()}>
        <p class="text-xs leading-5 text-warning">
          {t('channelSections.replacePickedChannelsWarning')}
        </p>
      </Show>
      <div class="max-h-64 overflow-y-auto" aria-busy={preview.isFetching}>
        <For
          each={queryReadyGate(preview) ? (preview.data?.channels ?? []) : []}
        >
          {(channel) => (
            <div
              class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm"
              classList={{
                'text-ink-extra-muted':
                  'isParticipant' in channel && channel.isParticipant === false,
              }}
            >
              <HashIcon class="size-4 shrink-0" />
              <span class="truncate">{channel.name}</span>
            </div>
          )}
        </For>
        <Show when={preview.isLoading}>
          <p class="px-2 py-3 text-xs text-ink-muted">
            {t('channelSections.matchingChannelsLoading')}
          </p>
        </Show>
        <Show when={preview.isError}>
          <p role="alert" class="px-2 py-3 text-xs text-failure-ink">
            {t('channelSections.matchesUnavailable')}
          </p>
        </Show>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-xs text-failure-ink">
          {error()}
        </p>
      </Show>
      <div class="flex items-center gap-2">
        <span class="flex-1 text-xs text-ink-muted">
          <Show when={queryReadyGate(preview)}>
            {t('channelSections.matchCount', {
              count: queryReadyGate(preview)
                ? (preview.data?.totalCount ?? 0)
                : 0,
            })}
          </Show>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onClose}
          disabled={saving()}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={saving() || !pattern().trim()}
        >
          {replacesPickedChannels()
            ? t('channelSections.replacePickedChannels')
            : t('channelSections.saveSection')}
        </Button>
      </div>
    </form>
  );
}
