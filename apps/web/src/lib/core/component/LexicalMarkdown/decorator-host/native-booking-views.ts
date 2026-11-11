import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import { BookingLinkMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { onCleanup } from 'solid-js';
import type { BookingLinkMentionUIProps } from '../component/decorator/BookingLinkMention';
import type { BookingLinkMentionHost } from './booking-host';
import { createNativeDecoratorAdapter } from './native-adapter';
import { createNativeContactContext } from './native-contact-host';

/** Published selection, the real Normal Enter slot and queued label writes. */
export function createNativeBookingLinkMentionContext(
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
    mentionHost(snapshot: ViewNode): BookingLinkMentionHost {
      const mounted = view;
      const generation = mounted?.mirror.keyGeneration;
      if (!mounted || generation == null)
        throw new Error('Booking mention requires an acknowledged native view');
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      return {
        ...enter.host,
        setLabel(key, label) {
          if (
            !alive ||
            view !== mounted ||
            mounted.mirror.keyGeneration !== generation ||
            key !== String(snapshot.key)
          )
            return;
          if (!(mounted.port instanceof SessionPort))
            throw new Error(
              'Booking labels require the actual native session port'
            );
          // Metadata writes keep the pending model selection; a DOM range is
          // neither their input nor authority to replace that selection.
          mounted.port.inputIfSessionEdit(
            EditorInputMsg.fromEditorApplication({
              name: 'group-b.booking-mention-label',
              json: JSON.stringify({ key: snapshot.key, label }),
              generation,
              selection: selectionMessage({ kind: 'keep' }),
              keyboard: false,
              key: '',
              mods: 0,
              code: 0,
            })
          );
        },
      };
    },
  };
}

export function createNativeBookingLinkMentionViews(
  context: ReturnType<typeof createNativeBookingLinkMentionContext>
): Pick<MacroDecorators, 'booking-link-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'booking-link-mention': bind<BookingLinkMentionUIProps>(
      BookingLinkMentionNode,
      (node) => {
        const { profileId, slug, label, url } = node.props();
        if (
          typeof profileId !== 'string' ||
          typeof url !== 'string' ||
          (slug !== undefined && slug !== null && typeof slug !== 'string') ||
          (label !== undefined && label !== null && typeof label !== 'string')
        )
          throw new Error('Invalid native booking mention props');
        return {
          profileId,
          slug,
          label,
          url,
          key: String(node.key),
          theme: context.theme,
          host: context.mentionHost(node),
        };
      }
    ),
  };
}
