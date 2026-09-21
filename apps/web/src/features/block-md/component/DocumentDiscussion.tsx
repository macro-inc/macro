import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUrlParams } from '@core/component/ParamsProvider';
import {
  DocumentConversation,
  DocumentConversationComposer,
} from '@core/messages/DocumentConversation';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { MessageParent } from '@service-storage/messages';
import { Show } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { useMarkdownDocument } from '../context/markdown-document-context';

function MobileComposer(props: { parent: MessageParent; hidden: boolean }) {
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

/**
 * Unanchored document roots rendered with the shared message components. On
 * touch devices the composer moves to the floating accessory region and the
 * conversation shows only once it has roots, as the editor page does.
 */
export function DocumentDiscussion(props: {
  editorHasFocus?: boolean;
  label?: string;
}) {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const id = documentId();
  const documentKind = kind();
  const blockName = documentKind === 'document' ? 'md' : documentKind;
  const params = useUrlParams(URL_PARAMS);
  const parent: MessageParent = { type: 'document', id };
  const floating = () => isTouchDevice();
  return (
    <>
      <DocumentConversation
        parent={parent}
        canWrite={permissions.canComment()}
        canManage={permissions.isOwner()}
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
      <Show when={floating() && permissions.canComment()}>
        <StaticMarkdownContext>
          <MobileComposer
            parent={parent}
            hidden={props.editorHasFocus === true && virtualKeyboardVisible()}
          />
        </StaticMarkdownContext>
      </Show>
    </>
  );
}
