import { useEmojiData } from '@core/component/Emoji/emojis';
import { recordEmojiUsage } from '@core/component/Emoji/emojiUsage';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { MenuEvent, MenuQuery } from './generated/native-bridge';
import type { NativeAndroidSurface } from './native-android';

/** The source emoji catalog feeds native rows; callbacks and catalog data stay in the app. */
export function NativeEmojiSources(props: {
  surface: Pick<NativeAndroidSurface, 'menuRows' | 'menuCommit'>;
  event: Accessor<MenuEvent | undefined>;
  onError(error: unknown): void;
}) {
  const [query, setQuery] = createSignal<MenuQuery>();
  const term = debouncedDependent(() => query()?.term.toLowerCase() ?? '', 200);
  const source = useEmojiData();
  let owner = props.surface;
  let disposed = false;
  let selected = false;

  function current(expected: MenuQuery, surface: typeof props.surface) {
    const active = query()?.identity;
    return (
      !disposed &&
      owner === surface &&
      props.surface === surface &&
      active?.mountGeneration === expected.identity.mountGeneration &&
      active.modelGeneration === expected.identity.modelGeneration &&
      active.invocation === expected.identity.invocation &&
      active.queryGeneration === expected.identity.queryGeneration
    );
  }

  function report(
    task: Promise<void>,
    expected: MenuQuery,
    surface: typeof props.surface,
    rejectedRowId?: string
  ) {
    async function finish() {
      try {
        await task;
      } catch (error) {
        if (!current(expected, surface)) return;
        try {
          if (rejectedRowId)
            await surface.menuRows({
              identity: expected.identity,
              rejectedRowId,
              rows: [],
              buckets: [],
            });
        } finally {
          if (current(expected, surface)) props.onError(error);
        }
      }
    }
    fireAndForget(finish(), 'native-emoji.provider');
  }

  function closeOwned() {
    const active = query();
    if (active)
      fireAndForget(
        owner.menuRows({ identity: active.identity, rows: [], buckets: [] }),
        'native-emoji.close'
      );
  }

  function synchronizeOwner() {
    if (owner === props.surface) return;
    closeOwned();
    owner = props.surface;
    setQuery(undefined);
    selected = false;
  }

  createEffect(
    on(props.event, (event) => {
      synchronizeOwner();
      if (!event || event.query.kind !== 'emoji' || event.action === 'closed') {
        setQuery(undefined);
        selected = false;
        return;
      }
      if (event.action === 'query') {
        owner = props.surface;
        selected = false;
        setQuery(event.query);
        return;
      }
      const active = query();
      const surface = props.surface;
      if (
        !active ||
        !current(event.query, surface) ||
        selected ||
        event.action !== 'select'
      )
        return;
      const item =
        term() === active.term.toLowerCase()
          ? source.emojis().find((item) => item.slug === event.rowId)
          : undefined;
      if (!item) {
        report(
          surface.menuRows({
            identity: active.identity,
            rejectedRowId: event.rowId,
            rows: [],
            buckets: [],
          }),
          active,
          surface
        );
        return;
      }
      selected = true;
      recordEmojiUsage(item.emoji);
      report(
        surface.menuCommit({
          identity: active.identity,
          rowId: item.slug,
          choice: { kind: 'text', text: item.emoji },
        }),
        active,
        surface,
        item.slug
      );
    })
  );

  createEffect(() => {
    const active = query();
    if (!active || term() !== active.term.toLowerCase()) return;
    source.filter(term());
  });

  createEffect(() => {
    const active = query();
    if (!active || selected || owner !== props.surface) return;
    const ready = term() === active.term.toLowerCase();
    const items = ready ? source.emojis() : [];
    const surface = props.surface;
    report(
      surface.menuRows({
        identity: active.identity,
        rows: items.map((item) => ({
          id: item.slug,
          bucketId: 'emoji',
          label: item.emoji,
          detail: item.slug,
        })),
        buckets: [
          {
            id: 'emoji',
            label: 'Emoji',
            loadedCount: items.length,
            hasMore: false,
            isLoadingMore: false,
            isLoading: !ready || source.isLoading(),
            error: source.error() ? 'Emoji unavailable' : undefined,
          },
        ],
      }),
      active,
      surface
    );
  });

  createEffect(on(() => props.surface, synchronizeOwner, { defer: true }));
  onCleanup(() => {
    disposed = true;
    closeOwned();
  });
  return null;
}
