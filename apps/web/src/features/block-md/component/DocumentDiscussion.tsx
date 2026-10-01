import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import {
  Discussion,
  DiscussionComposer,
  DiscussionProvider,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUrlParams } from '@core/component/ParamsProvider';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import {
  useMessageLink,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import { Show } from 'solid-js';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';
import { useMarkdownDocument } from '../context/markdown-document-context';

function MobileDiscussionComposer(props: { hidden: boolean }) {
  // Preserve the editor and draft while its placement is hidden.
  const input = (
    <DiscussionComposer collapsible blurOnSend surfaceClass="bg-blue-bg" />
  );

  return (
    <FloatRegion region="accessory">
      <Show when={!props.hidden}>
        <ChannelInputContainer>{input}</ChannelInputContainer>
      </Show>
    </FloatRegion>
  );
}

/** Unanchored document roots rendered with the shared message components. */
export function MessageDocumentDiscussion(props: {
  label?: string;
  /**
   * On touch devices, move the composer to the floating accessory region and
   * show the conversation only once it has roots, as the editor page does.
   */
  floatingComposerOnTouch?: boolean;
  editorHasFocus?: boolean;
}) {
  const { documentId, kind, permissions } = useMarkdownDocument();
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
      canWrite={permissions.canComment()}
      link={{ type: blockName, id }}
      label={props.label}
      floatingComposerOnTouch={props.floatingComposerOnTouch}
      editorHasFocus={props.editorHasFocus}
      // The document's "Leave a comment" card is tinted apart from the page.
      composerClass="bg-blue-bg"
    />
  );
}

/** Document discussion: the document annotations source feeding the shared UI. */
export function DocumentDiscussion(props: {
  editorHasFocus: boolean;
  label?: string;
}) {
  if (isFeatureEnabled(enableUnifiedDocumentDiscussions)) {
    return (
      <MessageDocumentDiscussion
        floatingComposerOnTouch
        editorHasFocus={props.editorHasFocus}
        label={props.label}
      />
    );
  }
  return <LegacyDocumentDiscussion editorHasFocus={props.editorHasFocus} />;
}

function LegacyDocumentDiscussion(props: { editorHasFocus: boolean }) {
  const source = createDocumentDiscussionSource();
  return (
    <DiscussionProvider source={source}>
      <Show
        when={
          !isTouchDevice() ||
          source.threads().some((thread) => thread.comments.length > 0)
        }
      >
        <Discussion hideComposer={isTouchDevice()} composerClass="bg-blue-bg" />
      </Show>
      <Show when={isTouchDevice() && source.canEdit()}>
        <StaticMarkdownContext>
          <MobileDiscussionComposer
            hidden={props.editorHasFocus && virtualKeyboardVisible()}
          />
        </StaticMarkdownContext>
      </Show>
    </DiscussionProvider>
  );
}
