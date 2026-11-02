import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import {
  Button,
  Checkbox,
  Dialog,
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

type SectionChannelsDialogProps = {
  label: ChannelLabel;
  onConfirm: (channelIds: string[]) => Promise<string[]>;
};

/** Select additions only; membership removal stays in the channel's section menu. */
function SectionChannelsDialog(
  props: SectionChannelsDialogProps & ManagedDialogProps
) {
  const query = useAvailableSectionChannelsQuery();
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal(new Set<string>());
  const [added, setAdded] = createSignal(new Set<string>());
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
          added().has(channel.id)
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
      .filter((channel) => selected().has(channel.id))
      .map((channel) => channel.id);

  const toggleChannel = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
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
        props.onOpenChange(false);
        return;
      }

      const failures = new Set(failed);
      setAdded(
        (previous) =>
          new Set([...previous, ...ids.filter((id) => !failures.has(id))])
      );
      setSelected(failures);
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

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!saving()) {
          props.onOpenChange(open);
        }
      }}
      class="w-[min(30rem,90vw)]"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[75dvh] flex-col overflow-hidden rounded-xl text-ink"
      >
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) => fireAndForget(submit(event), 'channels-view')}
          aria-busy={saving()}
        >
          <div class="flex shrink-0 flex-col gap-3 px-5 pt-4 pb-3">
            <Dialog.Title class="text-base font-semibold">
              {t('channelSections.addChannelsTo', { name: props.label.name })}
            </Dialog.Title>
            <Dialog.Description class="text-xs leading-5 text-ink-muted">
              {props.label.teamId
                ? t('channelSections.teamChannelsOnly')
                : t('channelSections.personalChannelsHint')}{' '}
              {t('channelSections.moveFromOtherSection')}
            </Dialog.Description>
            <Input
              aria-label={t('channelSections.searchChannels')}
              placeholder={t('channelSections.searchChannels')}
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              readOnly={saving()}
            />
          </div>
          <div
            class="min-h-0 overflow-y-auto px-3"
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
                    <Checkbox
                      class="flex w-full gap-2 rounded-lg px-2 py-2 hover:bg-hover"
                      checked={selected().has(channel.id)}
                      disabled={saving()}
                      onChange={(checked) => toggleChannel(channel.id, checked)}
                    >
                      <Checkbox.Control />
                      <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <Show
                          when={channel.channel_type === 'private'}
                          fallback={
                            <HashIcon class="size-4 shrink-0 text-ink-muted" />
                          }
                        >
                          <LockIcon class="size-4 shrink-0 text-ink-muted" />
                        </Show>
                        <span class="truncate">
                          {channel.name ?? t('channelSections.unnamedChannel')}
                        </span>
                      </Checkbox.Label>
                    </Checkbox>
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
                  onClick={() =>
                    fireAndForget(query.refetch(), 'channels-view')
                  }
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
          <div class="flex shrink-0 justify-end gap-2 px-5 py-3">
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
              disabled={saving() || chosen().length === 0}
            >
              {saving()
                ? t('channelSections.saving')
                : t('channelSections.addSelectedChannels', {
                    count: chosen().length,
                  })}
            </Button>
          </div>
        </form>
      </Surface>
    </Dialog>
  );
}

export async function promptSectionChannels(
  props: SectionChannelsDialogProps,
  options?: OpenDialogOptions
): Promise<void> {
  const handle = openDialog(SectionChannelsDialog, props, options);
  await handle.closed;
}
