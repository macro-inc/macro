import { openChatWithAgent } from '@app/features/chat/ChatWithAgentButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { fireAndForget } from '@core/util/fireAndForget';
import { For, Show } from 'solid-js';
import { DraftOriginBar } from './components/draft-origin-bar';
import { useDraftOrigin } from './queries/draft-origin';
import { createItemOpener } from './suggestion-actions';
import { SuggestionFeedback } from './suggestion-feedback';
import { SUGGESTION_ITEM_PARTS } from './suggestion-items';

/** What Rewrite types into the agent composer after the thread, for the person to finish. */
const REWRITE_REQUEST =
  'Rewrite my draft reply in this thread, keeping it a draft: ';

/**
 * The footer for a reply draft a suggestions session wrote, for the thread
 * that shows it. Renders nothing for any other draft, or while suggestions
 * are off.
 */
export function SuggestionDraftOrigin(props: {
  draftId: string;
  thread: { id: string; name: string };
}) {
  const origin = useDraftOrigin(() => props.draftId);
  const openItem = createItemOpener(useSplitLayout());
  const rewrite = () =>
    fireAndForget(
      openChatWithAgent(
        { type: 'email', id: props.thread.id, name: props.thread.name },
        REWRITE_REQUEST
      ),
      'suggestions.rewrite_draft'
    );

  return (
    <Show when={origin()}>
      {(found) => (
        <DraftOriginBar
          onRewrite={rewrite}
          feedback={
            <SuggestionFeedback
              suggestionId={found().suggestionId}
              surface="suggestion_draft"
            />
          }
        >
          <For each={found().sources}>
            {(source) => (
              <SUGGESTION_ITEM_PARTS.Source
                target={source}
                onOpen={() => openItem(source)}
              />
            )}
          </For>
        </DraftOriginBar>
      )}
    </Show>
  );
}
