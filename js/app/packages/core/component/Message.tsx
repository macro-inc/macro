import { observedSize } from '@core/directive/observedSize';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type DateValue, formatDate } from '@core/util/date';
import IconPlus from '@icon/regular/plus.svg';
import {
  type Accessor,
  type Component,
  createContext,
  createMemo,
  createSignal,
  type JSX,
  type Setter,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { BozzyBracket } from './BozzyBracket';
import {
  CustomEntityIcon,
  EntityIcon,
  type EntityWithValidIcon,
} from './EntityIcon';
import { UserIcon } from './UserIcon';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';

false && observedSize;

export type MessageRootProps = {
  id?: string;
  focused: boolean;
  unfocusable?: boolean;
  senderId?: string;
  customIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  customIconTargetType?: EntityWithValidIcon;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isConsecutive?: boolean;
  timestamp?: DateValue;
  hoverActions?: () => JSX.Element;
  shouldHover?: boolean;
  threadDepth?: number;
  hasThreadChildren?: boolean;
  isFirstInThread?: boolean;
  isLastInThread?: boolean;
  isDeleted?: boolean;
  isNewMessage?: boolean;
  isParentNewMessage?: boolean;
  shouldShowThreadAppendInput?: boolean;
  setThreadAppendMountTarget?: (el: HTMLElement) => void;
  onThreadAppend?: () => void;
  hideConnectors?: boolean;
  children: JSX.Element;
  setMessageBodyRef?: Setter<HTMLDivElement | undefined>;
  isTarget?: boolean;
};

type MessageContextValue = {
  focused: Accessor<boolean>;
  isFirstMessage: Accessor<boolean>;
  isLastMessage: Accessor<boolean>;
  isConsecutive: Accessor<boolean | undefined>;
  hoverActions: Accessor<JSX.Element | undefined>;
  threadDepth: Accessor<number | undefined>;
  isFirstInThread: Accessor<boolean | undefined>;
  isLastInThread: Accessor<boolean | undefined>;
  isDeleted: Accessor<boolean | undefined>;
  hover: Accessor<boolean>;
  setHover: Setter<boolean>;
};

const MessageContext = createContext<MessageContextValue>();
export function useMessageContext(): MessageContextValue {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('Message.* must be used within <Message>');
  return ctx;
}

/* TopBar */

export type MessageTopBarSimpleProps = {
  name: string;
  timestamp?: DateValue | null;
  tagLabel?: string;
  tagIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | undefined;
};

export type MessageTopBarChildrenProps = {
  children: JSX.Element;
};

export type MessageTopBarProps =
  | MessageTopBarSimpleProps
  | MessageTopBarChildrenProps;

function isTopBarChildrenProps(
  props: MessageTopBarProps
): props is MessageTopBarChildrenProps {
  return 'children' in props;
}

const TopBar: Component<MessageTopBarProps> = (props) => {
  const context = useMessageContext();

  if (isTopBarChildrenProps(props)) {
    return props.children;
  }

  const [local] = splitProps(props as MessageTopBarSimpleProps, [
    'name',
    'timestamp',
    'tagLabel',
    'tagIcon',
  ]);
  return (
    <Show when={!context.isConsecutive()}>
      <div class="font-mono flex flex-row items-center justify-between">
        {/*  Name */}
        <div class="ph-no-capture shrink-1 min-w-0 text-sm truncate text-ink-muted">
          {local.name}
        </div>
        {/* Tag */}
        <Show when={local.tagLabel}>
          <div class="inline-flex items-center ml-2 px-0.5 text-xs bg-edge/15 text-ink border-1 border-edge/30 max-w-[240px] min-w-0">
            <div class="flex-shrink-0 px-0.5">
              <Show when={local.tagIcon}>
                <CustomEntityIcon icon={local.tagIcon!} size="xs" />
              </Show>
            </div>
            <span class="truncate">{local.tagLabel}</span>
          </div>
        </Show>
        {/* Date - hidden when hovering since it shows above hover actions */}
        <Show when={local.timestamp && !context.hover()}>
          <div class="text-xs mobile:text-sm text-ink-muted min-w-0 shrink-2 truncate">
            {local.timestamp && formatDate(local.timestamp)}
          </div>
        </Show>
      </div>
    </Show>
  );
};

/* Body */

export type MessageBodyProps = {
  children: JSX.Element;
  isDeleted?: boolean;
};

const Body: Component<MessageBodyProps> = (props) => {
  return (
    <Show
      when={!props.isDeleted}
      fallback={
        <div class="text-xs text-ink-muted font-mono">Message Deleted</div>
      }
    >
      <div class="ph-no-capture text-sm text-ink pr-4">{props.children}</div>
    </Show>
  );
};

type NestedConnectorLinesProps = {
  threadDepth?: number;
  isParentNewMessage?: boolean;
};

export const NestedConnectorLines: Component<NestedConnectorLinesProps> = (
  props
) => {
  const NestedLines: JSX.Element[] = [];
  for (let i = 0; i < (props.threadDepth ?? 0); i++) {
    NestedLines.push(
      <div
        class="absolute h-full border-l"
        classList={{
          'border-accent': props.isParentNewMessage,
          'border-edge-muted': !props.isParentNewMessage,
        }}
        style={{
          left: `calc(${i} * var(--thread-shift) + var(--left-of-connector))`,
        }}
      />
    );
  }

  return (
    <div class="absolute left-0 top-0 w-full h-full z-1 pointer-events-none">
      {NestedLines}
    </div>
  );
};

/* Root */

const Root: Component<MessageRootProps> = (props) => {
  const [hover, setHover] = createSignal(false);
  const [replySize, setReplySize] = createSignal<DOMRect>();
  const ctx: MessageContextValue = {
    focused: () => props.focused,
    isFirstMessage: () => props.isFirstMessage,
    isLastMessage: () => props.isLastMessage,
    isConsecutive: () => props.isConsecutive,
    hoverActions: () => props.hoverActions?.(),
    threadDepth: () => props.threadDepth,
    isFirstInThread: () => props.isFirstInThread,
    isLastInThread: () => props.isLastInThread,
    isDeleted: () => props.isDeleted,
    hover,
    setHover,
  };

  const replyHeight = createMemo(() => {
    return replySize()?.height ?? 0;
  });

  return (
    <MessageContext.Provider value={ctx}>
      <div
        class={`relative flex flex-row items-stretch w-full suppress-css-brackets transition-colors duration-1000 ease`}
        classList={{
          'bg-accent': props.isTarget,
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <Show when={!props.hideConnectors}>
          <NestedConnectorLines
            threadDepth={props.threadDepth}
            isParentNewMessage={props.isParentNewMessage}
          />
        </Show>
        <BozzyBracket
          active={props.focused}
          unfocusable={props.isTarget || props.unfocusable}
          class="flex flex-row"
          style={{
            'margin-bottom': props.isLastInThread //|| props.showReply?.()
              ? `${replyHeight()}px`
              : '0px',
          }}
          hover={props.shouldHover}
        >
          {/* Message Wrapper w/ Main Connector Line */}
          <div
            class="w-full"
            style={{
              'padding-left': `calc(${props.threadDepth ?? 0} * var(--thread-shift))`,
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            tabIndex={props.isDeleted || props.unfocusable ? -1 : 0}
            ref={props.setMessageBodyRef}
            data-message-body-id={props.id}
          >
            <div
              class={cn(
                'relative flex flex-col pl-[calc(var(--user-icon-width)/2+var(--message-padding-x))] ml-[var(--left-of-connector)]',
                !props.hideConnectors && 'border-l',
                props.isNewMessage ? 'border-accent' : 'border-edge-muted',
                !(
                  props.isConsecutive ||
                  props.isFirstMessage ||
                  props.isFirstInThread
                ) && 'pt-2',
                props.isLastMessage && 'pb-4',
                props.hasThreadChildren && 'pb-4'
              )}
            >
              {/* User Icon */}
              <div class="absolute left-0 -translate-x-1/2">
                <Show when={!props.isConsecutive}>
                  <div class="relative">
                    <Show when={props.isFirstInThread}>
                      {/* Slanted Line Connector */}
                      <div
                        class={cn(
                          'absolute text-edge-muted -z-1',
                          props.isNewMessage && 'text-accent'
                        )}
                        style={{
                          left: `calc((var(--thread-shift) - var(--left-of-connector) + var(--left-of-user-icon) + 1px) * -1)`,
                          bottom:
                            'calc(var(--user-icon-width) / 2 - 0.0375 * var(--user-icon-width))',
                          width: `calc(var(--thread-shift) - var(--left-of-connector) + var(--left-of-user-icon) + 3px)`,
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 18"
                          width="100%"
                        >
                          <path
                            stroke="currentColor"
                            vector-effect="non-scaling-stroke"
                            d="M23 17 4 6.0303C2.5 5.1643.5 4 .5.5"
                          />
                        </svg>
                      </div>
                    </Show>
                    <Show
                      when={props.customIcon || props.customIconTargetType}
                      fallback={
                        <div
                          class="flex justify-center items-center"
                          style={{
                            width: `var(--user-icon-width)`,
                            height: `var(--user-icon-width)`,
                          }}
                        >
                          <UserIcon
                            id={props.senderId ?? ''}
                            isDeleted={false}
                            size="fill"
                            suppressClick={true}
                          />
                        </div>
                      }
                    >
                      <div
                        class="flex justify-center items-center"
                        style={{
                          width: `var(--user-icon-width)`,
                          height: `var(--user-icon-width)`,
                        }}
                      >
                        <EntityIcon
                          targetType={props.customIconTargetType}
                          size="fill"
                        />
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
              {/* Message Body */}
              {props.children}
            </div>
          </div>
        </BozzyBracket>
        <Show
          when={
            props.hoverActions &&
            !isTouchDevice() &&
            (hover() || !!props.shouldHover)
          }
        >
          <div
            class="absolute right-0 -top-4 flex flex-col items-end z-tool-tip"
            classList={{
              block: props.focused || !!props.shouldHover,
              hidden: !(props.focused || !!props.shouldHover),
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            data-message-id={props.id}
          >
            <Show when={props.timestamp}>
              {(timestamp) => (
                <div class="absolute top-0 translate-y-[-100%] bg-panel pl-2 pt-2 text-xs text-ink-muted font-mono mb-0.5 select-text cursor-default">
                  {formatDate(timestamp(), {
                    showTime: true,
                  })}
                </div>
              )}
            </Show>
            <div class="border border-edge bg-panel">
              {props.hoverActions?.()}
            </div>
          </div>
        </Show>
        <Show when={props.isLastInThread}>
          <div
            class="absolute bottom-0 w-full"
            use:observedSize={{
              setSize: setReplySize,
            }}
          >
            <Show
              when={props.shouldShowThreadAppendInput}
              fallback={
                <div
                  class="w-min -translate-x-1/2 icon-plus allow-css-brackets"
                  style={{
                    'margin-left': `calc(var(--thread-shift) + var(--left-of-connector))`,
                  }}
                  onMouseEnter={() => setHover(false)}
                >
                  <Button
                    onClick={props.onThreadAppend}
                    tabIndex={0}
                    class="text-ink-muted flex flex-row justify-center items-center relative px-0 py-0 hover:bg-transparent active:border-transparent active:bg-transparent active:text-inherit hover:opacity-100"
                  >
                    <div class="border border-edge-muted bg-menu hover:bg-hover hover-transition-bg flex flex-row justify-center items-center ml-2 mr-2 mb-2 size-[var(--user-icon-width)] touch:min-h-[var(--user-icon-width)] touch:min-w-[var(--user-icon-width)]">
                      <IconPlus class="size-1/2" />
                    </div>
                  </Button>
                </div>
              }
            >
              <div
                class="relative"
                classList={{
                  'pb-3': props.isLastInThread && props.isLastMessage,
                }}
                style={{
                  'margin-left': `calc(var(--left-of-connector) + var(--thread-shift) + var(--user-icon-width) / 2)`,
                }}
                onMouseEnter={() => setHover(false)}
                ref={(el) => props.setThreadAppendMountTarget?.(el)}
              >
                <div
                  class="absolute border-l border-edge-muted"
                  style={{
                    left: `calc((var(--user-icon-width) / 2) * -1)`,
                    height:
                      'calc(50% - (var(--user-icon-width) / 2 + 1px) / 24 * 18 + 1px)',
                  }}
                />

                <div
                  class="absolute text-edge-muted -z-1"
                  style={{
                    left: `calc((var(--user-icon-width) / 2) * -1)`,
                    bottom: '50%',
                    width: `calc(var(--user-icon-width) / 2 + 1px)`,
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 18"
                    width="100%"
                  >
                    <path
                      stroke="currentColor"
                      vector-effect="non-scaling-stroke"
                      d="M23 17 4 6.0303C2.5 5.1643.5 4 .5.5"
                    />
                  </svg>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </MessageContext.Provider>
  );
};

export const Message = Object.assign(Root, {
  TopBar,
  Body,
});
