import { useMaybeBlockName } from '@core/block';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Show } from 'solid-js';
import { HostedMentionsMenu } from '../component/menu/MentionsMenu/HostedMentionsMenu';
import type { MentionsMenuOptions } from '../component/menu/MentionsMenu/props';
import type { MenuOperations } from '../shared/inlineMenu';
import {
  createNativeUserMentionMenuHost,
  type NativeUserMentionSource,
} from './overlay-hosts/native-user-mention-menu';

export type NativeUserMentionsOptions = NativeUserMentionSource &
  Pick<MentionsMenuOptions, 'users' | 'entities' | 'portalScope'>;

/** USER is the first stage; remaining source kinds retain explicit coverage gaps. */
export function NativeUserMentionsOverlay(props: {
  view: EditorView;
  menu: MenuOperations;
  source: NativeUserMentionsOptions;
  alive: () => boolean;
}) {
  return (
    <Show when={props.alive()}>
      <HostedMentionsMenu
        menu={props.menu}
        users={props.source.users}
        entities={props.source.entities}
        portalScope={props.source.portalScope}
        sourceDocumentId={props.source.sourceDocumentId}
        disableMentionTracking={props.source.disableMentionTracking}
        useBlockBoundary={true}
        showOpenTabs
        sources={['users']}
        includeGroups={false}
        includeContacts={false}
        createHost={(blockId) =>
          createNativeUserMentionMenuHost(
            props.view,
            {
              blockName: useMaybeBlockName(),
              sourceDocumentId: blockId ?? props.source.sourceDocumentId,
              onUserMention: props.source.onUserMention,
              disableMentionTracking: props.source.disableMentionTracking,
            },
            props.alive
          )
        }
      />
    </Show>
  );
}
