import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import type { SlackPageState } from '../primitives/slack-page';
import { ConversationSearch, SlackPageBody } from './shared/slack-page-parts';

/**
 * The Slack page on desktop: a search toolbar that stays in reach while the
 * catalogue scrolls, and each conversation's kind and last activity.
 */
export function SlackPage(props: { page: SlackPageState }) {
  return (
    <SlackPageBody
      page={props.page}
      display={{ details: true, addLabel: true }}
      toolbar={
        <div class="sticky top-0 z-10 flex flex-col gap-2 bg-panel px-4 pt-4 pb-1">
          <div class="flex min-w-64 max-w-md flex-1 items-center gap-2">
            <ConversationSearch page={props.page} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Add workspace"
              onClick={() => props.page.flow.start()}
            >
              <PlusIcon class="size-3.5" />
              Add workspace
            </Button>
          </div>
        </div>
      }
    />
  );
}
