import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import {
  Discussion,
  DiscussionComposer,
  DiscussionProvider,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';

/** Document discussion: the document annotations source feeding the shared UI. */
export function DocumentDiscussion() {
  const source = createDocumentDiscussionSource();
  return (
    <DiscussionProvider source={source}>
      <Discussion hideComposer={isTouchDevice()} />
      <Show when={isTouchDevice() && source.canEdit()}>
        <StaticMarkdownContext>
          <DiscussionComposer collapsible>
            {(input) => (
              <FloatRegion region="accessory">
                <ChannelInputContainer>{input}</ChannelInputContainer>
              </FloatRegion>
            )}
          </DiscussionComposer>
        </StaticMarkdownContext>
      </Show>
    </DiscussionProvider>
  );
}
