import { onCleanup } from 'solid-js';
import { useBlockCollabParent } from './blockParent';
import {
  type CollabMarkdownControls,
  CollabMarkdownEditor,
  type CollabMarkdownEditorProps,
} from './CollabMarkdownEditor';
import { createCollabSurfaceSession } from './createCollabSurface';

export type CollabMdSurfaceControls = CollabMarkdownControls;
export type CollabMdSurfaceProps = Omit<
  CollabMarkdownEditorProps,
  'sourceId' | 'session'
> & {
  surfaceId: string;
  initialMarkdown?: string;
  optimisticSnapshot?: Uint8Array;
};

/** Existing block adapter: derive the parent, then pass explicit state to the editor. */
export function CollabMdSurface(props: CollabMdSurfaceProps) {
  const session = createCollabSurfaceSession(props.surfaceId, {
    parent: useBlockCollabParent(),
    initialMarkdown: props.initialMarkdown,
    optimisticSnapshot: props.optimisticSnapshot,
  });
  onCleanup(session.dispose);
  return (
    <CollabMarkdownEditor
      {...props}
      sourceId={props.surfaceId}
      session={session}
    />
  );
}
