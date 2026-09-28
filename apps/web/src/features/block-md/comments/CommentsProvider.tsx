import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { Accessor, VoidComponent } from 'solid-js';
import { LegacyCommentsProvider } from './LegacyCommentsProvider';
import { MessageCommentsProvider } from './MessageCommentsProvider';

/** Binds the editor's comment marks to whichever comment store this document uses. */
export const CommentsProvider: VoidComponent<{
  activeComment?: Accessor<string | undefined>;
  loroManager: LoroManager;
}> = (props) =>
  isFeatureEnabled(enableUnifiedDocumentDiscussions) ? (
    <MessageCommentsProvider
      activeComment={props.activeComment}
      loroManager={props.loroManager}
    />
  ) : (
    <LegacyCommentsProvider
      activeComment={props.activeComment}
      loroManager={props.loroManager}
    />
  );
