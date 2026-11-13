import { isMobile } from '@core/mobile/isMobile';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { SlackPageState } from '../../primitives/slack-page';
import { ConversationSearch, SlackPageBody } from '../shared/slack-page-parts';

/**
 * The Slack page on touch: rows keep to the name, organizations and status,
 * and phones show the add buttons as icons.
 */
export function MobileSlackPage(props: { page: SlackPageState }) {
  return (
    <SlackPageBody
      page={props.page}
      display={{ details: false, addLabel: !isMobile() }}
      toolbar={
        <div class="flex flex-col gap-2 bg-panel px-4 pt-4 pb-1">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <ConversationSearch page={props.page} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Add workspace"
              onClick={() => props.page.flow.start()}
            >
              <PlusIcon class="size-3.5" />
              <Show when={!isMobile()}>Add workspace</Show>
            </Button>
          </div>
        </div>
      }
    />
  );
}
