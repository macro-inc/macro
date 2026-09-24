import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import {
  Discussion,
  DiscussionComposer,
  DiscussionProvider,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  useParamNavigationCount,
  useUrlParams,
} from '@core/component/ParamsProvider';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  DocumentConversation,
  DocumentConversationComposer,
} from '@core/messages/DocumentConversation';
import { scrollToRenderedTarget } from '@core/messages/scroll-to-rendered-target';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { MessageParent } from '@service-storage/messages';
import { createEffect, createMemo, on, onCleanup, Show } from 'solid-js';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';
import { URL_PARAMS } from '../constants';
import { useMarkdownDocument } from '../context/markdown-document-context';

function MobileDiscussionComposer(props: { hidden: boolean }) {
  // Preserve the editor and draft while its placement is hidden.
  const input = <DiscussionComposer collapsible blurOnSend />;

  return (
    <FloatRegion region="accessory">
      <Show when={!props.hidden}>
        <ChannelInputContainer>{input}</ChannelInputContainer>
      </Show>
    </FloatRegion>
  );
}

function MobileMessageComposer(props: {
  parent: MessageParent;
  hidden: boolean;
}) {
  // Preserve the editor and draft while its placement is hidden.
  const input = (
    <DocumentConversationComposer
      parent={props.parent}
      collapsible
      blurOnSend
    />
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
  const params = useUrlParams(URL_PARAMS);
  const parent: MessageParent = { type: 'document', id };
  const floating = () =>
    props.floatingComposerOnTouch === true && isTouchDevice();
  let container: HTMLDivElement | undefined;
  // Scroll to the linked message once per navigation of `comment_id`, as the
  // margin does for anchored comments. A repeat navigation to the same message
  // still scrolls; the URL value showing through after a navigation cleared it
  // does not.
  const commentNavigationCount = useParamNavigationCount(URL_PARAMS.commentId);
  const scrollRequest = createMemo(
    () => {
      const commentId = params.commentId();
      if (!commentId) return undefined;
      const count = commentNavigationCount();
      return {
        commentId,
        key: count === 0 ? `url:${commentId}` : `navigation:${count}`,
      };
    },
    undefined,
    { equals: (a, b) => a?.key === b?.key }
  );
  let scrolledKey: string | undefined;
  createEffect(
    on(scrollRequest, (request) => {
      if (!request || !container || request.key === scrolledKey) return;
      scrolledKey = request.key;
      onCleanup(scrollToRenderedTarget(container, request.commentId));
    })
  );
  return (
    <>
      <div ref={container} class="contents">
        <DocumentConversation
          parent={parent}
          canWrite={permissions.canComment()}
          targetId={params.commentId()}
          label={props.label}
          buildLink={(message) =>
            buildSimpleEntityUrl(
              { type: blockName, id },
              { [URL_PARAMS.commentId]: message.id }
            )
          }
          hideComposer={floating()}
          hideWhenEmpty={floating()}
        />
      </div>
      <Show when={floating() && permissions.canComment()}>
        <StaticMarkdownContext>
          <MobileMessageComposer
            parent={parent}
            hidden={props.editorHasFocus === true && virtualKeyboardVisible()}
          />
        </StaticMarkdownContext>
      </Show>
    </>
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
        <Discussion hideComposer={isTouchDevice()} />
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
