import { Show } from 'solid-js';
import { HostedSnippetsMenu } from '../component/menu/SnippetsMenu/SnippetsMenu';
import type { MenuOperations } from '../shared/inlineMenu';
import type { SnippetMenuHost } from './overlay-hosts/snippets';

export type NativeSnippetsOptions = { sourceDocumentId: string };

/** The shared snippet catalog over the native snippet host. */
export function NativeSnippetsOverlay(props: {
  host: SnippetMenuHost;
  menu: MenuOperations;
  source: NativeSnippetsOptions;
  alive: () => boolean;
}) {
  return (
    <Show when={props.alive()}>
      <HostedSnippetsMenu
        host={props.host}
        menu={props.menu}
        useBlockBoundary={true}
        sourceDocumentId={props.source.sourceDocumentId}
      />
    </Show>
  );
}
