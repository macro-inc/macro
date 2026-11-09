import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  type ComponentProps,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { MentionsMenu } from '../component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import type { NativeMentionPresentation } from '../component/LexicalMarkdown/component/menu/MentionsMenu/native-presentation';
import { getMentionItemLabelParts } from '../component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils';
import { createItemHandler } from '../component/LexicalMarkdown/component/menu/MentionsMenu/utils/mentionHandlers';
import { createMenuOperations } from '../component/LexicalMarkdown/shared/inlineMenu';
import type {
  HandlerDependencies,
  MentionItem,
} from '../component/LexicalMarkdown/utils/mentionsUtils';
import type {
  MenuEvent,
  MenuIdentity,
  MenuQuery,
} from './generated/native-bridge';
import type { NativeAndroidSurface } from './native-android';
import { nativeMentionChoice } from './native-mention-choice';

type MentionOptions = Omit<
  ComponentProps<typeof MentionsMenu>,
  'editor' | 'anchor' | 'onPick' | 'menu' | 'nativePresentation'
>;

/** The app's real mention sources/controller feed the native presentation without a DOM menu. */
export function NativeMentionSources(props: {
  surface: Pick<NativeAndroidSurface, 'menuRows' | 'menuCommit'>;
  event: Accessor<MenuEvent | undefined>;
  anchor: HTMLElement;
  mentions?: MentionOptions;
  handlers: Omit<HandlerDependencies, 'editor'>;
  onError(error: unknown): void;
}) {
  const menu = createMenuOperations();
  const [query, setQuery] = createSignal<MenuQuery>();
  const [selection, setSelection] =
    createSignal<ReturnType<NativeMentionPresentation['selection']>>();
  const [more, setMore] =
    createSignal<ReturnType<NativeMentionPresentation['more']>>();
  let sequence = 0;
  let owner = props.surface;

  function closeOwned() {
    const identity = query()?.identity;
    if (identity)
      fireAndForget(
        owner.menuRows({ identity, rows: [], buckets: [] }),
        'native-mentions.close'
      );
  }

  function current(identity: MenuIdentity) {
    const active = query()?.identity;
    return (
      owner === props.surface &&
      active?.mountGeneration === identity.mountGeneration &&
      active.modelGeneration === identity.modelGeneration &&
      active.invocation === identity.invocation &&
      active.queryGeneration === identity.queryGeneration
    );
  }

  createEffect(
    on(props.event, (event) => {
      if (
        !event ||
        event.query.kind !== 'mention' ||
        event.action === 'closed'
      ) {
        setQuery(undefined);
        setSelection(undefined);
        setMore(undefined);
        menu.setIsOpen(false);
        return;
      }
      if (event.action === 'query') {
        owner = props.surface;
        latest = undefined;
        setSelection(undefined);
        setMore(undefined);
        setQuery(event.query);
        menu.setSearchTerm(event.query.term);
        menu.setIsOpen(true);
      } else if (current(event.query.identity)) {
        if (event.action === 'select' && event.rowId)
          setSelection({ id: event.rowId, sequence: ++sequence });
        if (event.action === 'more' && event.bucketId)
          setMore({
            bucketId: event.bucketId,
            index: event.query.selectedIndex,
            sequence: ++sequence,
          });
      }
    })
  );

  onCleanup(() => {
    closeOwned();
    latest = undefined;
    setQuery(undefined);
    menu.closeMenu();
  });
  createEffect(
    on(
      () => props.surface,
      () => {
        closeOwned();
        latest = undefined;
        setQuery(undefined);
        setSelection(undefined);
        setMore(undefined);
        menu.closeMenu();
      },
      { defer: true }
    )
  );

  async function pick(item: MentionItem) {
    const identity = query()?.identity;
    if (!identity) return;
    const surface = props.surface;
    if (owner !== surface) return;
    const attempt = selection();
    const admitted = () =>
      props.surface === surface && current(identity) && selection() === attempt;
    let committed: Promise<void> = Promise.resolve();
    const editor: HandlerDependencies['editor'] = {
      dispatchCommand(command, payload) {
        if (!admitted()) return false;
        const choice = nativeMentionChoice(command, payload);
        if (choice)
          committed = surface.menuCommit({
            identity,
            rowId: item.id,
            choice,
          });
        return true;
      },
    };
    const handlers = props.handlers;
    try {
      await createItemHandler({
        ...handlers,
        editor,
        onUserMention: (record) => {
          if (admitted()) handlers.onUserMention?.(record);
        },
        onDocumentMention: (entity) => {
          if (admitted()) handlers.onDocumentMention?.(entity);
        },
        onEmailMention: (email) => {
          if (admitted()) handlers.onEmailMention?.(email);
        },
      })(item);
      await committed;
    } catch (error) {
      if (!admitted()) return;
      try {
        props.onError(error);
      } finally {
        await surface.menuRows({ identity, rows: [], buckets: [] });
      }
    }
  }

  let latest: Parameters<NativeMentionPresentation['publish']>[0] | undefined;
  const presentation: NativeMentionPresentation = {
    selection,
    more,
    rejected(rejected, reason) {
      const identity = query()?.identity;
      if (!identity || selection() !== rejected || owner !== props.surface)
        return;
      if (reason === 'missing') {
        fireAndForget(
          props.surface.menuRows({
            identity,
            rows: [],
            buckets: [],
            rejectedRowId: rejected.id,
          }),
          'native-mentions.missing'
        );
      } else if (latest) publishRows(latest, rejected.id);
    },
    publish(snapshot) {
      latest = snapshot;
      publishRows(snapshot);
    },
  };

  function publishRows(
    snapshot: Parameters<NativeMentionPresentation['publish']>[0],
    rejectedRowId?: string
  ) {
    const active = query();
    const identity = active?.identity;
    if (
      !identity ||
      owner !== props.surface ||
      !menu.isOpen() ||
      snapshot.term !== active.term
    )
      return;
    const rows = snapshot.items.map((item) => {
      const bucketId =
        snapshot.viewAll ??
        snapshot.buckets.find((bucket) =>
          bucket.getData().some((candidate) => candidate.id === item.id)
        )?.id;
      if (!bucketId) throw new Error('Native mention has no source bucket');
      const labels = getMentionItemLabelParts(item);
      return {
        id: item.id,
        label: labels.name ?? '',
        detail: labels.detail ?? undefined,
        bucketId,
        disabled: item.kind === 'user' && item.data.offline === true,
      };
    });
    const buckets = snapshot.buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      loadedCount: bucket.getFullCount(),
      hasMore: bucket.hasMore?.() ?? false,
      isLoadingMore: bucket.isLoadingMore?.() ?? false,
      ...snapshot.status(bucket.id),
    }));
    fireAndForget(
      props.surface.menuRows({ identity, rows, buckets, rejectedRowId }),
      'native-mentions.rows'
    );
  }

  return (
    <MentionsMenu
      {...props.mentions}
      menu={menu}
      anchor={props.anchor}
      onPick={(item) => fireAndForget(pick(item), 'native-mentions.pick')}
      nativePresentation={presentation}
    />
  );
}
