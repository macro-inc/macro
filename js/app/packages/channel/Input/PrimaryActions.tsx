import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput, useInputActions } from './context';
import CheckSquareIcon from '@icon/regular/check-square.svg';
import PlusIcon from '@icon/regular/plus.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import TrashIcon from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import { renderIcon } from './render-icon';
import { Button } from '@ui/components/Button';
import { LabelAndHotKey } from '@core/component/Tooltip';

function InputActionButton(props: {
  label: string;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  children: JSX.Element;
}) {
  return (
    <Button
      title={props.label}
      aria-label={props.label}
      tooltip={<LabelAndHotKey label={props.label} />}
      onClick={(event) => props.onClick?.(event)}
      classList={{ 'bg-active': props.active }}
    >
      {props.children}
    </Button>
  );
}

export function PrimaryActions(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const actions = useInputActions();
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex flex-row items-center gap-2', local.class)}
      data-input-primary-actions
      {...rest}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <InputActionButton
              label={input().showAttachMenu ? 'Close attach menu' : 'Attach'}
              active={input().showAttachMenu}
              onClick={(event) =>
                actions?.onToggleAttachMenu?.({ input: input(), event })
              }
            >
              <Show
                when={input().showAttachMenu}
                fallback={renderIcon(PlusIcon, 'size-5')}
              >
                {renderIcon(XIcon, 'size-5')}
              </Show>
            </InputActionButton>
            <InputActionButton
              label="Format"
              active={input().showFormatRibbon}
              onClick={(event) =>
                actions?.onToggleFormatRibbon?.({ input: input(), event })
              }
            >
              {renderIcon(FormatIcon, 'size-5')}
            </InputActionButton>
            <InputActionButton
              label="Task mode"
              active={input().taskModeEnabled}
              onClick={(event) =>
                actions?.onToggleTaskMode?.({ input: input(), event })
              }
            >
              {renderIcon(CheckSquareIcon, 'size-5')}
            </InputActionButton>
            <Show when={input().isReplyInput}>
              <InputActionButton
                label="Delete reply"
                onClick={(event) =>
                  actions?.onCloseDraft?.({ input: input(), event })
                }
              >
                {renderIcon(TrashIcon, 'size-5')}
              </InputActionButton>
            </Show>
          </>
        }
      >
        {local.children}
      </Show>
    </div>
  );
}
