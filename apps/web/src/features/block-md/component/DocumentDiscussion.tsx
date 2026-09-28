import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import {
  Discussion,
  DiscussionComposer,
  DiscussionProvider,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { Show } from 'solid-js';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';
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
  return (
    <EntityDiscussion
      parent={{ type: 'document', id }}
      canWrite={permissions.canComment()}
      link={{ type: blockName, id }}
      label={props.label}
      floatingComposerOnTouch={props.floatingComposerOnTouch}
      editorHasFocus={props.editorHasFocus}
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
