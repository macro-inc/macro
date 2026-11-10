import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import {
  Button,
  Checkbox,
  Dialog,
  InlineCheckbox,
  Input,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  Surface,
} from '@ui';
import {
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';

const searchChannels = createFreshSearch<ApiChannelWithLatest>({
  config: {
    ...NAME_MATCH_RANKING,
    fuzzyWeight: 1,
    timeWeight: 0,
    brevityWeight: 0,
  },
  getName: (channel) => channel.name ?? '',
  getTimestamp: (channel) => ({ updatedAt: channel.updated_at }),
});

export type SectionChannelsPickerProps = {
  label: ChannelLabel;
  presentation?: 'sheet';
  onConfirm: (channelIds: string[]) => Promise<string[]>;
  onClose: () => void;
};

/** Select additions only; membership removal stays in the channel's section menu. */
export function SectionChannelsPicker(props: SectionChannelsPickerProps) {
  const query = useAvailableSectionChannelsQuery();
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal<string[]>([]);
  const [added, setAdded] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const available = createMemo(() => {
    if (query.isPending) {
      return [];
    }

    return (query.data ?? [])
      .filter((channel) => {
        if (
          !channel.is_participant ||
          props.label.channelIds.includes(channel.id) ||
          added().includes(channel.id)
        ) {
          return false;
        }

        if (props.label.teamId) {
          return (
            channel.channel_type === 'team' &&
            channel.team_id === props.label.teamId
          );
        }

        return (
          channel.channel_type === 'team' ||
          channel.channel_type === 'public' ||
          channel.channel_type === 'private'
        );
      })
      .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
  });
  const visible = createMemo(() =>
    searchChannels(available(), search()).map((result) => result.item)
  );
  const chosen = () =>
    available()
      .filter((channel) => selected().includes(channel.id))
      .map((channel) => channel.id);

  const toggleChannel = (id: string, checked: boolean) => {
    setSelected((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }

      return current.filter((selectedId) => selectedId !== id);
    });
  };

  const submit = async () => {
    const ids = chosen();

    if (saving() || ids.length === 0) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const failed = await props.onConfirm(ids);

      if (disposed) {
        return;
      }

      if (failed.length === 0) {
        props.onClose();
        return;
      }

      setAdded((previous) => [
        ...previous,
        ...ids.filter((id) => !failed.includes(id)),
      ]);
      setSelected(failed.filter((id, index) => failed.indexOf(id) === index));
      setError(
        t('channelSections.addChannelsFailed', { count: failed.length })
      );
    } catch {
      if (!disposed) {
        setError(t('channelSections.unavailable'));
      }
    } finally {
      if (!disposed) {
        setSaving(false);
      }
    }
  };

  const channelFace = (channel: ApiChannelWithLatest) => (
    <>
      <Show
        when={channel.channel_type === 'private'}
        fallback={<HashIcon class="size-4 shrink-0 text-ink-muted" />}
      >
        <LockIcon class="size-4 shrink-0 text-ink-muted" />
      </Show>
      <span class="truncate">
        {channel.name ?? t('channelSections.unnamedChannel')}
      </span>
    </>
  );

  const body = () => (
    <>
      <Show
        when={props.presentation === 'sheet'}
        fallback={
          <div class="flex h-10 w-full shrink-0 items-center gap-2 border-b border-edge-muted px-3 focus-within:ring-2 focus-within:ring-edge-muted">
            <SearchIcon class="size-4 shrink-0 text-ink-muted" />
            <Input
              variant="bare"
              class="h-full rounded-none border-0 px-0 focus-visible:ring-0"
              type="text"
              aria-label={t('channelSections.searchChannels')}
              placeholder={t('channelSections.searchChannels')}
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              readOnly={saving()}
            />
          </div>
        }
      >
        <div class="flex shrink-0 flex-col gap-2 px-5 pt-4 pb-3">
          <Input
            type="text"
            aria-label={t('channelSections.searchChannels')}
            placeholder={t('channelSections.searchChannels')}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            readOnly={saving()}
          />
        </div>
      </Show>
      <div
        class="min-h-0 flex-1 overflow-y-auto px-3"
        aria-busy={query.isFetching}
      >
        <Switch>
          <Match when={query.isPending}>
            <p class="px-2 py-4 text-sm text-ink-muted">
              {t('channelSections.loadingChannels')}
            </p>
          </Match>
          <Match when={visible().length > 0}>
            <For each={visible()}>
              {(channel) => (
                <Show
                  when={props.presentation === 'sheet'}
                  fallback={
                    <Checkbox
                      class="flex w-full gap-2 rounded-lg px-2 py-2 hover:bg-hover"
                      checked={selected().includes(channel.id)}
                      disabled={saving()}
                      onChange={(checked) => toggleChannel(channel.id, checked)}
                    >
                      <Checkbox.Control />
                      <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        {channelFace(channel)}
                      </Checkbox.Label>
                    </Checkbox>
                  }
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected().includes(channel.id)}
                    disabled={saving()}
                    class="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm disabled:opacity-50"
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      toggleChannel(
                        channel.id,
                        !selected().includes(channel.id)
                      )
                    }
                  >
                    <InlineCheckbox checked={selected().includes(channel.id)} />
                    {channelFace(channel)}
                  </button>
                </Show>
              )}
            </For>
          </Match>
          <Match when={!query.isError}>
            <p class="px-2 py-4 text-sm text-ink-muted">
              {search().trim()
                ? t('channelSections.noMatchingChannels')
                : t('channelSections.noChannelsToAdd')}
            </p>
          </Match>
        </Switch>
        <Show when={query.isError}>
          <div class="flex items-center justify-between gap-2 px-2 py-3 text-xs text-ink-muted">
            {t('channelSections.channelsUnavailable')}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fireAndForget(query.refetch(), 'channels-view')}
            >
              {t('channelSections.retry')}
            </Button>
          </div>
        </Show>
      </div>
      <Show when={error()}>
        <p role="alert" class="px-5 pt-3 text-xs text-failure">
          {error()}
        </p>
      </Show>
    </>
  );

  return (
    <form
      class="flex min-h-0 flex-col"
      classList={{
        'flex-1': props.presentation === 'sheet',
        'max-h-[min(30rem,65dvh)]': props.presentation !== 'sheet',
      }}
      onSubmit={(event) => {
        event.preventDefault();
        fireAndForget(submit(), 'channels-view');
      }}
      aria-busy={saving()}
    >
      <Show
        when={props.presentation === 'sheet'}
        fallback={
          <>
            {body()}
            <div class="flex shrink-0 justify-end gap-2 px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                disabled={saving()}
                onClick={props.onClose}
              >
                {t('channelSections.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={saving() || chosen().length === 0}
              >
                {saving()
                  ? t('channelSections.saving')
                  : t('channelSections.addSelectedChannels', {
                      count: chosen().length,
                    })}
              </Button>
            </div>
          </>
        }
      >
        <PickerSheet.Header
          title={t('channelSections.addChannels')}
          doneDisabled={saving() || chosen().length === 0}
          onDone={() => fireAndForget(submit(), 'channels-view')}
        />
        <PickerSheet.Body>{body()}</PickerSheet.Body>
      </Show>
    </form>
  );
}

function SectionChannelsDialog(
  props: Omit<SectionChannelsPickerProps, 'onClose'> & ManagedDialogProps
) {
  const [saving, setSaving] = createSignal(false);

  const onConfirm = async (channelIds: string[]) => {
    setSaving(true);
    try {
      return await props.onConfirm(channelIds);
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
        class="flex max-h-[min(30rem,65dvh)] flex-col overflow-hidden rounded-xl text-ink"
      >
        <Dialog.Title class="sr-only">
          {t('channelSections.addChannelsTo', { name: props.label.name })}
        </Dialog.Title>
        <Dialog.Description class="sr-only">
          {props.label.teamId
            ? t('channelSections.addSharedChannelsHint')
            : t('channelSections.addPersonalChannelsHint')}
        </Dialog.Description>
        <SectionChannelsPicker
          label={props.label}
          onConfirm={onConfirm}
          onClose={() => props.onOpenChange(false)}
        />
      </Surface>
    </Dialog>
  );
}

export async function promptSectionChannels(
  props: Omit<SectionChannelsPickerProps, 'onClose'>,
  options?: OpenDialogOptions
): Promise<void> {
  const handle = openDialog(SectionChannelsDialog, props, options);
  await handle.closed;
}
