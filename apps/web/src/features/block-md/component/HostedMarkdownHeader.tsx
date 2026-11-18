import { useSplitHeaderScope } from '@components/app/SplitHeaderScope';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { type Accessor, Show } from 'solid-js';
import { MobileMarkdownHeader } from '../views/mobile/markdown-header';

/**
 * A document's header inside another view's pane. A touch view that shows a
 * document beside its list hosts the document's own header (a
 * `SplitHeaderScope`), so the document draws the mobile header its block
 * shows. Any other host keeps its own bar, and this renders nothing.
 */
export function HostedMarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
  onDuplicate?: (id: string, name: string) => void;
  onDelete?: () => void;
}) {
  const hosted = useSplitHeaderScope();

  return (
    <Show when={hosted}>
      <MobileMarkdownHeader
        collaborationStatus={props.collaborationStatus}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
      />
    </Show>
  );
}
