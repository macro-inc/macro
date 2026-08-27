import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import WarningIcon from '@phosphor/warning.svg';
import {
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  splitProps,
} from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

const DEFAULT_FEEDBACK_MS = 2000;

/** Visual state of a copy control after the last click. */
export type CopyStatus = 'idle' | 'success' | 'failure';

export type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'children'> & {
  /** Text copied on click. Ignored when `onCopy` is provided. */
  text?: string | (() => string);
  /** Custom copy action. Throw or reject to show the warning icon. */
  onCopy?: () => void | Promise<void>;
  /** How long to keep the check or warning before restoring the copy icon. */
  feedbackDuration?: number;
  /** Accessible name after a successful copy. */
  successLabel?: string;
  /** Accessible name after a failed copy. */
  failureLabel?: string;
  children?: ButtonProps['children'];
};

function resolveText(text: string | (() => string) | undefined): string {
  if (text == null) return '';
  return typeof text === 'function' ? text() : text;
}

/**
 * Icon button that copies to the clipboard, swapping the copy icon for a
 * check on success or a warning on failure, then restoring after a short delay.
 */
export function CopyButton(props: CopyButtonProps) {
  const [local, rest] = splitProps(props, [
    'text',
    'onCopy',
    'feedbackDuration',
    'successLabel',
    'failureLabel',
    'label',
    'tooltip',
    'class',
    'size',
    'variant',
    'children',
  ]);
  const [status, setStatus] = createSignal<CopyStatus>('idle');
  let resetTimeout: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(resetTimeout));

  const idleLabel = () => local.label ?? local.tooltip ?? 'Copy';
  const statusLabel = () => {
    switch (status()) {
      case 'success':
        return local.successLabel ?? 'Copied';
      case 'failure':
        return local.failureLabel ?? "Couldn't copy";
      default:
        return idleLabel();
    }
  };

  const scheduleReset = () => {
    clearTimeout(resetTimeout);
    resetTimeout = setTimeout(
      () => setStatus('idle'),
      local.feedbackDuration ?? DEFAULT_FEEDBACK_MS
    );
  };

  const handleClick: ButtonProps['onClick'] = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (local.onCopy) {
        await local.onCopy();
      } else {
        const text = resolveText(local.text);
        if (!text) {
          throw new Error('Nothing to copy');
        }
        await navigator.clipboard.writeText(text);
      }
      setStatus('success');
    } catch (error) {
      console.error('Failed to copy to clipboard', error);
      setStatus('failure');
    }
    scheduleReset();
  };

  return (
    <Button
      variant={local.variant ?? 'ghost'}
      size={local.size ?? 'icon-sm'}
      class={cn(
        local.class,
        status() === 'success' && 'text-success hover:text-success',
        status() === 'failure' && 'text-warning hover:text-warning'
      )}
      {...rest}
      data-copy-status={status()}
      label={statusLabel()}
      onClick={handleClick}
    >
      <Switch fallback={<CopyIcon />}>
        <Match when={status() === 'success'}>
          <CheckIcon />
        </Match>
        <Match when={status() === 'failure'}>
          <WarningIcon />
        </Match>
      </Switch>
      <Show when={local.children}>{local.children}</Show>
    </Button>
  );
}
