import { MobileDiscussion } from '@app/components/discussion/mobile-discussion';
import { useUrlParams } from '@core/component/ParamsProvider';
import { useIsAuthenticated } from '@core/context/user';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { isMobile } from '@core/mobile/isMobile';
import {
  useMessageLink,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import { Match, Switch } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';

/**
 * Unanchored document roots rendered with shared conversation components.
 * Phone tasks use the shared entry and sheet instead of a floating composer.
 */
type DocumentDiscussionProps = {
  editorHasFocus: boolean;
  label?: string;
};

export function DocumentDiscussion(props: DocumentDiscussionProps) {
  const authenticated = useIsAuthenticated();
  return (
    <Switch>
      <Match when={authenticated() === true}>
        <AuthenticatedDocumentDiscussion {...props} />
      </Match>
      <Match when={authenticated() === false}>
        <p class="mt-3 text-xs text-ink-muted">Sign in to view comments.</p>
      </Match>
    </Switch>
  );
}

function AuthenticatedDocumentDiscussion(props: DocumentDiscussionProps) {
  const { documentId, kind, permissions, state } = useMarkdownDocument();
  const id = documentId();
  const documentKind = kind();
  const blockName = documentKind === 'document' ? 'md' : documentKind;
  const parent = () => ({ type: 'document' as const, id });
  const params = useUrlParams({ commentId: COMMENT_LINK_PARAM });
  const target = useMessageLink(parent, params.commentId);
  const roots = useMessageRootsQuery(parent);
  const discussionTarget = () =>
    roots.isSuccess &&
    roots.data.find((thread) => thread.id === target.rootId())?.state.anchor ===
      null
      ? target.messageId()
      : null;
  return (
    <EntityDiscussion
      parent={parent()}
      targetId={discussionTarget()}
      scrollReady={state.editor.md.locationReady === true}
      canWrite={permissions.canComment()}
      canModerate={permissions.isOwner()}
      link={{ type: blockName, id }}
      label={props.label}
      floatingComposerOnTouch={documentKind !== 'task' || !isMobile()}
      children={
        documentKind === 'task' && isMobile()
          ? (conversation) => (
              <MobileDiscussion
                conversation={conversation}
                parent={parent()}
                canWrite={permissions.canComment()}
              />
            )
          : undefined
      }
      editorHasFocus={props.editorHasFocus}
    />
  );
}
