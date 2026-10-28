/**
 * The Review tab: Proofing (Spelling) and Comments (New Comment, Delete,
 * Previous, Next, Show Comments), as in PowerPoint.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import ChatText from '@icon/system/regular/chat-text.svg';
import Chats from '@icon/system/regular/chats.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import TextAUnderline from '@icon/system/regular/text-a-underline.svg';
import Trash from '@icon/system/regular/trash.svg';
import { Show } from 'solid-js';
import type { CommentsState } from '../../primitives/create-comments';
import {
  PopoverItem,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { useRibbon } from './ribbon';

/** What the Review tab drives (Insert ▸ Comment uses it too). */
export interface ReviewEnv {
  comments: CommentsState;
  /** Opens the Spelling pane (F7). */
  spelling: () => void;
}

export function ReviewTab() {
  const env = useRibbon();
  const ro = env.readonly;
  return (
    <Show when={env.review}>
      {(review) => {
        const c = () => review().comments;
        const none = () => c().threads().length === 0;
        return (
          <>
            <RibbonGroup label="Proofing">
              <RibbonTextButton
                label="Spelling"
                tooltip="Spelling (F7)"
                disabled={ro()}
                data-testid="pptx-review-spelling"
                onClick={() => review().spelling()}
              >
                <TextAUnderline />
                Spelling
              </RibbonTextButton>
            </RibbonGroup>
            <RibbonGroup label="Comments">
              <RibbonTextButton
                label="New Comment"
                tooltip="New Comment (Ctrl+Alt+M)"
                disabled={ro()}
                data-testid="pptx-review-new-comment"
                onClick={() => c().newComment()}
              >
                <ChatText />
                New Comment
              </RibbonTextButton>
              <RibbonPopover
                label="Delete"
                text="Delete"
                icon={<Trash class="size-4" />}
                disabled={ro() || c().count() === 0}
                testId="pptx-review-delete"
              >
                {(close) => (
                  <div class="flex w-72 flex-col">
                    <PopoverItem
                      label="Delete"
                      testId="pptx-review-delete-comment"
                      disabled={none()}
                      onClick={() => {
                        close();
                        fireAndForget(c().deleteCurrent(), 'pptx-editor');
                      }}
                    />
                    <PopoverItem
                      label="Delete All Comments on This Slide"
                      testId="pptx-review-delete-slide"
                      disabled={none()}
                      onClick={() => {
                        close();
                        fireAndForget(c().deleteAll('slide'), 'pptx-editor');
                      }}
                    />
                    <PopoverItem
                      label="Delete All Comments in This Presentation"
                      testId="pptx-review-delete-all"
                      onClick={() => {
                        close();
                        fireAndForget(
                          c().deleteAll('presentation'),
                          'pptx-editor'
                        );
                      }}
                    />
                  </div>
                )}
              </RibbonPopover>
              <RibbonTextButton
                label="Previous"
                tooltip="Previous comment"
                disabled={c().count() === 0}
                data-testid="pptx-review-previous"
                onClick={() => c().previous()}
              >
                <ArrowLeft />
                Previous
              </RibbonTextButton>
              <RibbonTextButton
                label="Next"
                tooltip="Next comment"
                disabled={c().count() === 0}
                data-testid="pptx-review-next"
                onClick={() => c().next()}
              >
                <ArrowRight />
                Next
              </RibbonTextButton>
              <RibbonTextButton
                label="Show Comments"
                tooltip="Show the Comments pane"
                aria-pressed={c().paneOpen()}
                data-testid="pptx-review-show-comments"
                onClick={() => c().togglePane()}
              >
                <Chats />
                Show Comments
              </RibbonTextButton>
              <RibbonPopover
                label="Comment display"
                icon={<span class="sr-only">Comment display</span>}
                testId="pptx-review-show-menu"
                placement="bottom-end"
              >
                {(close) => (
                  <div class="flex w-48 flex-col">
                    <PopoverItem
                      label="Comments Pane"
                      icon={
                        c().paneOpen() ? (
                          <CheckIcon class="size-3.5" />
                        ) : undefined
                      }
                      active={c().paneOpen()}
                      onClick={() => {
                        close();
                        c().togglePane();
                      }}
                    />
                    <PopoverItem
                      label="Show Markup"
                      testId="pptx-review-show-markup"
                      icon={
                        c().markup() ? (
                          <CheckIcon class="size-3.5" />
                        ) : undefined
                      }
                      active={c().markup()}
                      onClick={() => {
                        close();
                        c().setMarkup(!c().markup());
                      }}
                    />
                  </div>
                )}
              </RibbonPopover>
            </RibbonGroup>
          </>
        );
      }}
    </Show>
  );
}
