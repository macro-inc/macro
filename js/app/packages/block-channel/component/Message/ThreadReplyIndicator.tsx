import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { onKeyDownClick, onKeyUpClick } from '@core/util/click';
import { formatRelativeDate } from '@core/util/time';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg?component-solid';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

export function ThreadReplyIndicator(props: {
  countCollapsedMessages: number;
  timestamp: string;
  users: string[];
  onClick: () => void;
  justifyRight?: boolean;
  isThreadOpen?: boolean;
  hasDraft?: boolean;
}) {
  const [hover, setHover] = createSignal(false);
  let countText = () => {
    return props.hasDraft
      ? `${props.countCollapsedMessages} more repl${props.countCollapsedMessages > 1 ? 'ies' : 'y'} & 1 draft`
      : `${props.countCollapsedMessages} more repl${props.countCollapsedMessages > 1 ? 'ies' : 'y'}`;
  };

  const MAX_USERS = createMemo(() => (isMobileWidth() ? 3 : 6));
  const MAX_USERS_INDEX = createMemo(() => MAX_USERS() - 1);

  return (
    <div
      class="flex flex-row gap-2 items-center justify-between pb-2 pt-2 text-xs w-full max-w-fit border-edge-muted border pr-2 select-none hover:bg-hover focus:bracket-offset-2"
      onClick={props.onClick}
      onKeyDown={onKeyDownClick(props.onClick)}
      onKeyUp={onKeyUpClick(props.onClick)}
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        class={`flex flex-row items-center gap-2 w-full px-2 ${props.justifyRight ? 'justify-end' : ''}`}
      >
        <div class="flex flex-row gap-1 items-center relative">
          <For
            each={
              props.users.length > MAX_USERS()
                ? props.users.slice(0, MAX_USERS_INDEX())
                : props.users
            }
          >
            {(userId) => (
              <UserIcon
                id={userId}
                isDeleted={false}
                size="sm"
                suppressClick={true}
                fetchUrl={false}
              />
            )}
          </For>
          <Show when={props.users.length > MAX_USERS()}>
            <Tooltip tooltip={props.users.slice(MAX_USERS_INDEX()).join(', ')}>
              <div class="relative">
                <UserIcon
                  id={props.users[MAX_USERS_INDEX()]}
                  isDeleted={false}
                  size="sm"
                  suppressClick={true}
                  fetchUrl={false}
                />
                <div class="absolute top-0 left-0 w-full h-full flex items-center justify-center rounded-full bg-ink/50 text-panel">
                  +{props.users.length - MAX_USERS_INDEX()}
                </div>
              </div>
            </Tooltip>
          </Show>
        </div>
        <p class="text-accent-ink font-medium min-w-[60px] shrink-0">
          {countText()}
        </p>
        <div class="min-w-[17ch] hidden @sm:block">
          <Switch>
            <Match when={hover()}>
              <p class="text-ink-muted">
                {props.isThreadOpen ? 'Close thread' : 'Expand thread'}
              </p>
            </Match>
            <Match when={!hover()}>
              <p class="text-ink-muted">
                Last reply {formatRelativeDate(props.timestamp)}
              </p>
            </Match>
          </Switch>
        </div>
      </div>
      <CaretRight class={`w-4 h-4 ${hover() ? '' : 'invisible'}`} />
    </div>
  );
}
