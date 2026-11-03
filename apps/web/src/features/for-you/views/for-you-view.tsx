import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import RefreshIcon from '@icon/system/regular/arrows-clockwise.svg';
import TuneIcon from '@icon/system/regular/sliders-horizontal.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { FeedItemRow } from '../components/feed-item';
import type {
  FeedActions,
  FeedPreferences,
  FeedSource,
} from '../context/feed-source';
import { createFeed } from '../primitives/feed';

export function ForYouView(props: {
  focusedId?: string;
  source: FeedSource;
  preferences: FeedPreferences;
  actions: FeedActions;
}) {
  const feed = createFeed(props.source, props.preferences, props.actions);
  const emptyTitle = () => {
    if (feed.filter() === 'save_money') return t('forYou.emptySaveMoney');
    if (feed.filter() === 'make_money') return t('forYou.emptyMakeMoney');
    return t('forYou.empty');
  };
  const [tuning, setTuning] = createSignal(false);
  const [promptDraft, setPromptDraft] = createSignal('');
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  const refresh = async () => {
    setRefreshFailed(false);
    try {
      await props.source.refresh();
    } catch {
      setRefreshFailed(true);
    }
  };
  return (
    <section
      class="min-h-0 flex-1 overflow-y-auto px-8"
      aria-label={t('nav.forYou')}
    >
      <div class="mx-auto w-full max-w-200 pb-16 pt-12">
        <div class="flex items-start justify-between gap-6">
          <div>
            <h1 class="text-3xl font-medium tracking-tight">
              {t('nav.forYou')}
            </h1>
            <p class="mt-3 text-sm text-ink-muted">{t('forYou.subtitle')}</p>
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('forYou.refresh')}
              tooltip={t('forYou.refresh')}
              disabled={
                props.source.loading() ||
                props.source.refreshing() ||
                !props.source.canRetry()
              }
              onClick={() => fireAndForget(refresh(), 'for-you')}
            >
              <RefreshIcon class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPromptDraft(props.preferences.prompt());
                setTuning(true);
              }}
            >
              <TuneIcon class="size-4" />
              {t('forYou.tune')}
            </Button>
          </div>
        </div>
        <div class="mt-8 flex items-center justify-between gap-4 border-b border-edge-muted pb-4">
          <Tabs
            aria-label={t('forYou.filters')}
            size="sm"
            value={feed.filter()}
            onChange={feed.setFilter}
            options={[
              { value: 'all', label: t('forYou.all') },
              { value: 'task', label: t('forYou.tasks') },
              { value: 'idea', label: t('forYou.ideas') },
              { value: 'revisit', label: t('forYou.revisit') },
              { value: 'save_money', label: t('forYou.saveMoney') },
              { value: 'make_money', label: t('forYou.makeMoney') },
            ]}
          />
          <Show when={feed.canUndo()}>
            <Button variant="ghost" size="sm" onClick={feed.undo}>
              {t('forYou.undo')}
            </Button>
          </Show>
        </div>
        <Show when={props.source.error() || refreshFailed()}>
          <div
            role="alert"
            class="flex items-center justify-between gap-4 py-5 text-sm text-ink-muted"
          >
            <span>{t('forYou.loadError')}</span>
            <Show when={props.source.canRetry()}>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.source.loading() || props.source.refreshing()}
                onClick={() => fireAndForget(refresh(), 'for-you')}
              >
                {t('forYou.retry')}
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={feed.actionError()}>
          <p role="alert" class="py-4 text-sm text-failure">
            {t('forYou.actionError')}
          </p>
        </Show>
        <Show when={props.source.refreshing()}>
          <p role="status" class="pt-5 text-xs text-ink-muted">
            {t('forYou.refreshing')}
          </p>
        </Show>
        <Show
          when={!props.source.loading()}
          fallback={
            <div role="status" class="space-y-6 py-8">
              <p class="text-sm text-ink-muted">{t('forYou.loading')}</p>
              <For each={[0, 1, 2]}>
                {() => (
                  <div class="space-y-3">
                    <div class="skeleton-shimmer h-5 w-3/5 rounded bg-skeleton" />
                    <div class="skeleton-shimmer h-3 w-full rounded bg-skeleton" />
                    <div class="skeleton-shimmer h-3 w-4/5 rounded bg-skeleton" />
                  </div>
                )}
              </For>
            </div>
          }
        >
          <ul class="m-0 list-none p-0" aria-label={t('nav.forYou')}>
            <For
              each={feed.visible()}
              fallback={
                <Show when={!props.source.error() && !refreshFailed()}>
                  <li class="py-16 text-center">
                    <p class="text-sm">{emptyTitle()}</p>
                    <p class="mt-2 text-sm text-ink-muted">
                      {t('forYou.emptyHint')}
                    </p>
                  </li>
                </Show>
              }
            >
              {(item) => (
                <FeedItemRow
                  item={item}
                  focused={props.focusedId === item.id}
                  opening={feed.openingId() === item.id}
                  disabled={Boolean(feed.openingId())}
                  onStart={() => fireAndForget(feed.start(item), 'for-you')}
                  onOpenSource={() => feed.openSource(item)}
                  onDismiss={() => feed.dismiss(item.id)}
                />
              )}
            </For>
          </ul>
        </Show>
      </div>
      <Show when={tuning()}>
        <Dialog open position="center" onOpenChange={setTuning}>
          <div class="p-6">
            <div class="flex items-start justify-between gap-4">
              <Dialog.Title class="text-xl font-medium">
                {t('forYou.tuneTitle')}
              </Dialog.Title>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('forYou.close')}
                onClick={() => setTuning(false)}
              >
                <CloseIcon class="size-4" />
              </Button>
            </div>
            <Dialog.Description class="mt-3 text-sm text-ink-muted">
              {t('forYou.tuneDescription')}
            </Dialog.Description>
            <label for="feed-prompt" class="mt-6 block text-sm font-medium">
              {t('forYou.tuneLabel')}
            </label>
            <textarea
              id="feed-prompt"
              class="mt-2 min-h-36 w-full resize-y rounded-xl border border-edge-muted bg-transparent p-4 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-edge-muted"
              value={promptDraft()}
              maxLength={4000}
              onInput={(e) => setPromptDraft(e.currentTarget.value)}
            />
            <p class="mt-3 text-xs text-ink-extra-muted">
              {t('forYou.tuneHint')}
            </p>
            <div class="mt-6 flex justify-end">
              <Button
                variant="primary"
                size="md"
                disabled={!promptDraft().trim()}
                onClick={() => {
                  props.preferences.setPrompt(promptDraft().trim());
                  setTuning(false);
                }}
              >
                {t('forYou.tuneSave')}
              </Button>
            </div>
          </div>
        </Dialog>
      </Show>
    </section>
  );
}
