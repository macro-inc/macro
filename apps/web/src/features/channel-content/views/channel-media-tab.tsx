import { MediaImage } from '@channel/Media/MediaImage';
import { MediaVideo } from '@channel/Media/MediaVideo';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import { mapMediaItems } from '@channel/Media/media-items';
import { getDisplayName, idToEmail, tryMacroId } from '@core/user';
import ImageIcon from '@phosphor/image.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import { VList } from 'virtua/solid';
import { useChannelSharedContent } from '../queries/shared-content';

export function ChannelMediaTab(props: { channelId: string }) {
  const query = useChannelSharedContent(() => props.channelId, 'static');
  const [kind, setKind] = createSignal('all');
  const [sender, setSender] = createSignal('all');
  const [period, setPeriod] = createSignal('all');
  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const size = createElementSize(container);
  const columns = () => Math.max(1, Math.floor((size.width ?? 800) / 180));
  const references = () => (query.isSuccess ? query.data : []);
  const senders = createMemo(() => [
    ...new Set(references().map((item) => item.sender_id)),
  ]);
  const items = createMemo(() =>
    mapMediaItems(
      references().filter(
        (item) =>
          (sender() === 'all' || item.sender_id === sender()) &&
          (period() === 'all' ||
            Date.now() - Date.parse(item.created_at) <
              Number(period()) * 86400000)
      )
    ).filter((item) => kind() === 'all' || item.kind === kind())
  );
  const rows = createMemo(() => {
    const result = [];
    for (let offset = 0; offset < items().length; offset += columns())
      result.push(items().slice(offset, offset + columns()));
    return result;
  });
  return (
    <Suspense
      fallback={<div class="p-6 text-sm text-ink-muted">Loading media…</div>}
    >
      <div class="flex h-full min-h-0 flex-col px-6 py-5 touch:px-3 touch:pb-(--mobile-content-inset-bottom)">
        <div class="mb-6">
          <h1 class="text-xl font-semibold tracking-tight">Media</h1>
          <p class="mt-1 text-sm text-ink-muted">
            Photos and videos shared in this channel
          </p>
        </div>
        <div class="mb-5 flex flex-wrap items-center gap-3">
          <div
            class="flex items-center gap-1 rounded-lg bg-ink/5 p-1"
            role="group"
            aria-label="Media type"
          >
            <For
              each={[
                { id: 'all', label: 'All media' },
                { id: 'image', label: 'Photos' },
                { id: 'video', label: 'Videos' },
              ]}
            >
              {(option) => (
                <button
                  type="button"
                  aria-pressed={kind() === option.id}
                  class="rounded-md px-3 py-1.5 text-sm transition-colors"
                  classList={{
                    'bg-surface text-ink shadow-sm': kind() === option.id,
                    'text-ink-muted hover:text-ink': kind() !== option.id,
                  }}
                  onClick={() => setKind(option.id)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
          <select
            aria-label="Shared by"
            value={sender()}
            onChange={(event) => setSender(event.currentTarget.value)}
            class="h-9 max-w-56 rounded-lg border border-edge-muted bg-surface px-3 text-sm text-ink-muted"
          >
            <option value="all">Shared by anyone</option>
            <For each={senders()}>
              {(id) => (
                <option value={id}>
                  {getDisplayName(tryMacroId(id)) || idToEmail(id)}
                </option>
              )}
            </For>
          </select>
          <select
            aria-label="Date shared"
            value={period()}
            onChange={(event) => setPeriod(event.currentTarget.value)}
            class="h-9 rounded-lg border border-edge-muted bg-surface px-3 text-sm text-ink-muted"
          >
            <option value="all">Any time</option>
            <option value="7">Past week</option>
            <option value="30">Past month</option>
            <option value="365">Past year</option>
          </select>
          <Show
            when={kind() !== 'all' || sender() !== 'all' || period() !== 'all'}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setKind('all');
                setSender('all');
                setPeriod('all');
              }}
            >
              Clear filters
            </Button>
          </Show>
          <span class="ml-auto text-xs text-ink-muted">
            {items().length} {items().length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <Show
          when={query.isSuccess && items().length > 0}
          fallback={
            <div class="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-edge-muted p-8 text-center">
              <ImageIcon class="mb-4 size-8 text-ink-extra-muted" />
              <p class="text-sm font-medium">
                {query.isPending
                  ? 'Loading media…'
                  : query.isError
                    ? 'Could not load media'
                    : references().length
                      ? 'No media matches these filters'
                      : 'No media shared yet'}
              </p>
              <p class="mt-1 text-sm text-ink-muted">
                {references().length
                  ? 'Try another type, person, or date.'
                  : 'Photos and videos shared in Chat will appear here.'}
              </p>
              <Show when={query.isError}>
                <Button variant="ghost" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </Show>
            </div>
          }
        >
          <div
            ref={setContainer}
            class="min-h-0 flex-1"
            aria-label="Channel media gallery"
          >
            <VList data={rows()} class="size-full" itemSize={200}>
              {(row, rowIndex) => (
                <div
                  class="grid gap-3 pb-3"
                  style={{
                    'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
                  }}
                >
                  <For each={row}>
                    {(item, localIndex) => (
                      <button
                        type="button"
                        aria-label={`Open ${item.kind === 'image' ? 'photo' : 'video'} ${rowIndex() * columns() + localIndex() + 1}`}
                        class="group relative aspect-square overflow-hidden rounded-xl border border-edge-muted bg-ink/5 focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={() => {
                          setIndex(rowIndex() * columns() + localIndex());
                          setViewerOpen(true);
                        }}
                      >
                        <Show
                          when={item.kind === 'image'}
                          fallback={
                            <>
                              <MediaVideo.Preview
                                src={item.src}
                                class="size-full object-cover"
                              />
                              <MediaVideo.PlayOverlay />
                            </>
                          }
                        >
                          <MediaImage.Image
                            src={item.thumbSrc ?? item.src}
                            class="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                          />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </VList>
          </div>
        </Show>
        <MediaViewerDialog
          items={items}
          open={viewerOpen()}
          onOpenChange={setViewerOpen}
          currentIndex={index}
          onCurrentIndexChange={setIndex}
        />
      </div>
    </Suspense>
  );
}
