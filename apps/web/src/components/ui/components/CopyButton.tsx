import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import WarningIcon from '@phosphor/warning.svg';
import { createSignal, Match, onCleanup, Switch, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

const DEFAULT_RESET_MS = 2000;

type CopyStatus = 'idle' | 'success' | 'error';

/** Plain text to copy, or a getter invoked at click time. */
export type CopyButtonText =
  | string
  | (() => string | Promise<string | null | undefined>);

export type CopyButtonProps = Omit<ButtonProps, 'onClick'> & {
  /** Clipboard payload. Functions are called when the button is pressed. */
  text: CopyButtonText;
  /** How long the success/error icon stays visible. Defaults to 2000ms. */
  resetMs?: number;
  onCopied?: (text: string) => void;
  onCopyError?: (error: unknown) => void;
};

async function resolveCopyText(text: CopyButtonText): Promise<string> {
  const value = typeof text === 'function' ? await text() : text;
  return value ?? '';
}

async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable');
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Icon button that copies text to the clipboard. The copy glyph is replaced
 * with a check on success or a warning on failure, then resets after `resetMs`.
 */
export function CopyButton(props: CopyButtonProps) {
  const [local, rest] = splitProps(props, [
    'text',
    'resetMs',
    'onCopied',
    'onCopyError',
    'children',
    'label',
    'tooltip',
    'size',
    'class',
    'variant',
    'aria-label',
  ]);

  const [status, setStatus] = createSignal<CopyStatus>('idle');
  let resetTimeout: ReturnType<typeof setTimeout> | undefined;
  let copyGeneration = 0;

  onCleanup(() => {
    if (resetTimeout !== undefined) clearTimeout(resetTimeout);
  });

  const idleName = () =>
    local['aria-label'] ?? local.label ?? local.tooltip ?? 'Copy';

  const statusName = () => {
    switch (status()) {
      case 'success':
        return 'Copied';
      case 'error':
        return 'Copy failed';
      default:
        return idleName();
    }
  };

  const scheduleReset = () => {
    if (resetTimeout !== undefined) clearTimeout(resetTimeout);
    resetTimeout = setTimeout(() => {
      setStatus('idle');
      resetTimeout = undefined;
    }, local.resetMs ?? DEFAULT_RESET_MS);
  };

  const copy = async () => {
    const generation = ++copyGeneration;
    try {
      const value = await resolveCopyText(local.text);
      if (generation !== copyGeneration) return;
      if (!value) return;
      await writeClipboardText(value);
      if (generation !== copyGeneration) return;
      setStatus('success');
      local.onCopied?.(value);
      scheduleReset();
    } catch (error) {
      if (generation !== copyGeneration) return;
      setStatus('error');
      console.error('Failed to copy to clipboard', error);
      local.onCopyError?.(error);
      scheduleReset();
    }
  };

  const variant = () => {
    switch (status()) {
      case 'success':
        return 'success' as const;
      case 'error':
        return 'danger' as const;
      default:
        return local.variant ?? 'ghost';
    }
  };

  return (
    <Button
      size={local.size ?? 'icon-sm'}
      {...rest}
      variant={variant()}
      class={cn(
        local.class,
        status() === 'success' && 'text-success',
        status() === 'error' && 'text-failure'
      )}
      // Keep tooltip copy stable so Button's tooltip Show does not remount
      // the trigger (and wipe the status icon) when copy succeeds or fails.
      tooltip={local.tooltip ?? local.label ?? local['aria-label'] ?? 'Copy'}
      aria-label={statusName()}
      data-copy-status={status()}
      on:click={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void copy();
      }}
    >
      <Switch>
        <Match when={status() === 'success'}>
          <CheckIcon class="text-success" />
        </Match>
        <Match when={status() === 'error'}>
          <WarningIcon class="text-failure" />
        </Match>
        <Match when={status() === 'idle'}>
          <CopyIcon />
        </Match>
      </Switch>
      {local.children}
    </Button>
  );
}
