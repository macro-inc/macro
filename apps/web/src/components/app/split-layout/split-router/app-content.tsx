import { LIST_VIEW_ID } from '@app/constants/list-views';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import {
  spreadsheetDetailSearch,
  spreadsheetDetailSearchCodec,
  spreadsheetLocationParams,
} from '@app/features/block-spreadsheet/spreadsheet-route';
import type { Entry } from '@app/lib/split-router';
import {
  chatDetailSearch,
  chatDetailSearchCodec,
  chatLocationParams,
} from '@block-chat/chat-route';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import type { BlockOrchestrator } from '@core/orchestrator';
import { lazyNamed } from '@core/util/lazyNamed';
import { type Accessor, createComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { type ComponentMeta, resolveComponent } from '../componentRegistry';
import {
  createSplitLayout,
  type SplitContent,
  type SplitContentAdapter,
  type SplitLayoutOptions,
  type SplitManager,
  type SplitMount,
} from '../layoutManager';

const ChatBlock = lazyNamed(() => import('@block-chat/ChatBlock'), 'ChatBlock');
const SpreadsheetBlock = lazyNamed(
  () => import('@app/features/block-spreadsheet/SpreadsheetBlock'),
  'default'
);

/** App composition owns feature selection and legacy-runtime compatibility. */
export function createAppContentAdapter(
  orchestrator: BlockOrchestrator
): SplitContentAdapter {
  function mount(
    content: SplitContent,
    options: {
      routeOwned: boolean;
      destination?: Accessor<Readonly<Entry> | undefined>;
    }
  ): SplitMount {
    if (content.type === 'component') {
      const resolved = resolveComponent(content.id, content.params);
      const [meta, setMeta] = createStore<ComponentMeta>(
        resolved.initialMeta ?? {}
      );
      return {
        kind: 'component',
        name: content.id,
        element: resolved.element,
        meta,
        updateMeta: (data) =>
          setMeta({ kind: content.id, ...data } as ComponentMeta),
      };
    }

    const blockType = resolveBlockAlias(content.type);
    const { destination, routeOwned } = options;
    if (blockType === 'chat') {
      return {
        kind: 'block',
        type: content.type,
        id: content.id,
        claim: `block:chat:${content.id}`,
        element: () =>
          createComponent(ChatBlock, {
            chatId: content.id,
            get params() {
              const next = destination?.();
              if (!next) return chatLocationParams(content.params);
              const target = chatDetailSearchCodec.parse(
                next.location.search?.[chatDetailSearch.namespace]
              );
              if (!target.valid || target.value.chatId !== content.id)
                return {};
              return chatLocationParams({
                message_id: target.value.messageId,
                share: target.value.share,
              });
            },
            get navigationRequest() {
              return destination?.()?.id;
            },
            routeOwned,
          }),
        aliasContext: content.aliasContext,
      };
    }
    if (blockType === 'spreadsheet') {
      return {
        kind: 'block',
        type: content.type,
        id: content.id,
        claim: `block:spreadsheet:${content.id}`,
        element: () =>
          createComponent(SpreadsheetBlock, {
            documentId: content.id,
            get params() {
              const next = destination?.();
              if (!next) return spreadsheetLocationParams(content.params);
              const target = spreadsheetDetailSearchCodec.parse(
                next.location.search?.[spreadsheetDetailSearch.namespace]
              );
              if (!target.valid || target.value.documentId !== content.id)
                return {};
              return spreadsheetLocationParams({
                comment_id: target.value.commentId,
                share: target.value.share,
              });
            },
            get navigationRequest() {
              return destination?.()?.id;
            },
            routeOwned,
          }),
        aliasContext: content.aliasContext,
      };
    }
    const handle = orchestrator.createBlockInstance(blockType, content.id, {
      aliasContext: content.aliasContext,
      params: content.params,
    });
    return {
      kind: 'block',
      type: content.type,
      id: content.id,
      element: handle.element,
      aliasContext: content.aliasContext,
    };
  }

  return {
    mount,
    normalize(content) {
      if (content.type === 'component' || !isBlockAlias(content.type))
        return content;
      return {
        ...content,
        aliasContext: {
          alias: content.type,
          baseType: resolveBlockAlias(content.type),
        },
      };
    },
    identity(content) {
      const route =
        content.type === 'component' ? parseAgentsRoute(content.id) : undefined;
      return route
        ? {
            type:
              route.conversation.type === 'agent_session' ? 'agent' : 'chat',
            id: route.conversation.id,
          }
        : content;
    },
    adopt(mount, current, next) {
      if (current.type !== 'component') {
        orchestrator.rekeyBlockInstance(
          resolveBlockAlias(current.type),
          current.id,
          next.id
        );
      }
      return mount.kind === 'block' ? { ...mount, id: next.id } : mount;
    },
    reopen(content) {
      void reopenLatest(content);
    },
  };

  async function reopenLatest(content: SplitContent) {
    try {
      const handle = await orchestrator.getBlockHandle(content.id);
      await handle?.goToLatest();
    } catch (error) {
      console.error('openWithSplit: goToLatest failed', error);
    }
  }
}

/** Production adapters are supplied here, never selected by the layout manager. */
export function createAppSplitLayout(
  orchestrator: BlockOrchestrator,
  options: Omit<SplitLayoutOptions, 'content' | 'defaultSplitContent'> & {
    defaultSplitContent?: SplitContent;
  }
): SplitManager {
  const manager = createSplitLayout({
    ...options,
    content: createAppContentAdapter(orchestrator),
    defaultSplitContent: options.defaultSplitContent ?? {
      type: 'component',
      id: LIST_VIEW_ID.home,
    },
  });
  return { ...manager, getOrchestrator: () => orchestrator };
}
