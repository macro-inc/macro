import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  useParamNavigationCount,
  useUrlParams,
} from '@core/component/ParamsProvider';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { MessageParent } from '@service-storage/messages';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { COMMENT_LINK_PARAM } from './comment-link';
import {
  EntityConversation,
  EntityConversationComposer,
} from './EntityConversation';
import { scrollToRenderedTarget } from './scroll-to-rendered-target';

function MobileMessageComposer(props: {
  parent: MessageParent;
  hidden: boolean;
}) {
  // Preserve the editor and draft while its placement is hidden.
  const input = (
    <EntityConversationComposer parent={props.parent} collapsible blurOnSend />
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
 * An entity's unanchored discussion on the shared message components, opened
 * at the message a `comment_id` link names.
 */
export function EntityDiscussion(props: {
  parent: MessageParent;
  canWrite: boolean;
  /** Delete comments the caller did not write. Document owners set this. */
  canModerate?: boolean;
  /** Where copied message links open: the entity's block and id. */
  link: { type: string; id: string };
  label?: string;
  /** Override the URL target; null leaves this discussion untargeted. */
  targetId?: string | null;
  /**
   * On touch devices, move the composer to the floating accessory region and
   * show the conversation only once it has roots, as the editor page does.
   */
  floatingComposerOnTouch?: boolean;
  editorHasFocus?: boolean;
}) {
  const params = useUrlParams({ commentId: COMMENT_LINK_PARAM });
  const commentId = () =>
    props.targetId === undefined ? params.commentId() : props.targetId;
  const floating = () =>
    props.floatingComposerOnTouch === true && isTouchDevice();
  let container: HTMLDivElement | undefined;
  // Scroll to the linked message once per navigation of `comment_id`, as the
  // margin does for anchored comments. A repeat navigation to the same message
  // still scrolls; the URL value showing through after a navigation cleared it
  // does not.
  const commentNavigationCount = useParamNavigationCount(COMMENT_LINK_PARAM);
  const scrollRequest = createMemo(
    () => {
      const target = commentId();
      if (!target) return undefined;
      const count = commentNavigationCount();
      return {
        commentId: target,
        key: count === 0 ? `url:${target}` : `navigation:${count}`,
      };
    },
    undefined,
    { equals: (a, b) => a?.key === b?.key }
  );
  // Clicking the linked message releases its highlight until the next
  // navigation to a comment.
  const [clearedKey, setClearedKey] = createSignal<string>();
  const targetCleared = () => {
    const key = scrollRequest()?.key;
    return key !== undefined && key === clearedKey();
  };
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
        <EntityConversation
          parent={props.parent}
          canWrite={props.canWrite}
          canModerate={props.canModerate}
          targetId={commentId()}
          targetCleared={targetCleared()}
          onClearTarget={() => setClearedKey(scrollRequest()?.key)}
          label={props.label}
          buildLink={(message) =>
            buildSimpleEntityUrl(props.link, {
              [COMMENT_LINK_PARAM]: message.id,
            })
          }
          hideComposer={floating()}
          hideWhenEmpty={floating()}
        />
      </div>
      <Show when={floating() && props.canWrite}>
        <StaticMarkdownContext>
          <MobileMessageComposer
            parent={props.parent}
            hidden={props.editorHasFocus === true && virtualKeyboardVisible()}
          />
        </StaticMarkdownContext>
      </Show>
    </>
  );
}
