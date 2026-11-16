import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Show } from 'solid-js';
import { HostedEmojiMenu } from '../component/menu/EmojiMenu';
import type { MenuOperations } from '../shared/inlineMenu';
import { createNativeEmojiMenuHost } from './overlay-hosts/native-emoji-menu';

/** The shared emoji picker over the native search controller. */
export function NativeEmojiOverlay(props: {
  view: EditorView;
  menu: MenuOperations;
  alive: () => boolean;
}) {
  const host = createNativeEmojiMenuHost(props.view, props.alive);
  return (
    <Show when={props.alive()}>
      <HostedEmojiMenu host={host} menu={props.menu} useBlockBoundary={true} />
    </Show>
  );
}
