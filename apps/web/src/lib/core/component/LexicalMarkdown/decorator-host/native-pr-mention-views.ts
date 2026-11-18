import { PullRequestMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { onCleanup } from 'solid-js';
import type { PullRequestMentionUIProps } from '../component/decorator/PullRequestMention';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import { createNativeDecoratorAdapter } from './native-adapter';
import { createNativeContactContext } from './native-contact-host';
import type { PullRequestMentionHost } from './pr-mention-host';

export function createNativePullRequestMentionContext(
  theme: EditorThemeClasses
) {
  const enter = createNativeContactContext(theme);
  let view: Parameters<typeof enter.bindView>[0] | undefined;
  return {
    ...enter,
    bindView(incoming: Parameters<typeof enter.bindView>[0]) {
      enter.bindView(incoming);
      view = incoming;
    },
    dispose() {
      view = undefined;
      enter.dispose();
    },
    mentionHost(
      snapshot: ViewNode,
      expected: {
        id?: string | null;
        label?: string | null;
        mentionUuid?: string | null;
        url?: string;
      }
    ): PullRequestMentionHost {
      const mounted = view;
      const generation = mounted?.mirror.keyGeneration;
      if (!mounted || generation == null)
        throw new Error('PR mention requires an acknowledged native view');
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      return {
        ...enter.host,
        previewFetchEnabled: () => true,
        enrich(_key, label, url) {
          if (
            !alive ||
            view !== mounted ||
            mounted.mirror.keyGeneration !== generation ||
            mounted.node(snapshot.key)?.type !== 'pr-mention'
          )
            return;
          dispatchApplicationCommandIfSessionEdit(
            mounted,
            'group-b.pr-enrich',
            {
              key: snapshot.key,
              expected: {
                // The stored model keeps a missing id apart from a null one.
                ...(expected.id === undefined ? {} : { id: expected.id }),
                ...(expected.label === undefined
                  ? {}
                  : { label: expected.label }),
                ...(expected.url === undefined ? {} : { url: expected.url }),
                ...(expected.mentionUuid === undefined
                  ? {}
                  : { mentionUuid: expected.mentionUuid }),
              },
              ...(label === undefined ? {} : { label }),
              ...(url === undefined ? {} : { url }),
            }
          );
        },
      };
    },
  };
}

export function createNativePullRequestMentionViews(
  context: ReturnType<typeof createNativePullRequestMentionContext>
): Pick<MacroDecorators, 'pr-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'pr-mention': bind<PullRequestMentionUIProps>(
      PullRequestMentionNode,
      (node) => {
        const { id, label, url, mentionUuid } = node.props();
        if (
          (id != null && typeof id !== 'string') ||
          (label != null && typeof label !== 'string') ||
          (url !== undefined && typeof url !== 'string') ||
          (mentionUuid != null && typeof mentionUuid !== 'string')
        )
          throw new Error('Invalid native PR mention payload');
        const captured = { id, label, url, mentionUuid };
        return {
          ...captured,
          key: String(node.key),
          theme: context.theme,
          host: context.mentionHost(node, captured),
        };
      }
    ),
  };
}
