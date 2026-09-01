import { writeClipboardData } from '@core/util/dataTransfer';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import WarningIcon from '@phosphor/warning.svg';
import {
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
  splitProps,
} from 'solid-js';
import { match } from 'ts-pattern';
import { Button, type ButtonProps } from './Button';

export type CopyStatus = 'idle' | 'success' | 'failure';

const DEFAULT_RESET_MS = 2000;

export type CopyButtonProps = Omit<ButtonProps, 'children'> & {
  /** Plain text to write. Re-read on each click when passed as a function. */
  text?: string | (() => string | Promise<string>);
  /**
   * Custom copy. Return `false` or throw to show the warning icon; `true` or
   * `void` shows the check mark.
   */
  copy?: () => boolean | void | Promise<boolean | void>;
  /** Show "Copy" / "Copied" / "Couldn't copy" next to the icon. */
  labeled?: boolean;
  successLabel?: string;
  failureLabel?: string;
  resetMs?: number;
  onCopied?: (ok: boolean) => void;
};

/**
 * Icon button that writes to the clipboard and swaps the copy icon for a
 * check mark on success or a warning on failure, then resets.
 */
export function CopyButton(props: CopyButtonProps) {
  const [local, rest] = splitProps(props, [
    'text',
    'copy',
    'labeled',
    'successLabel',
    'failureLabel',
    'resetMs',
    'onCopied',
    'onClick',
    'label',
    'tooltip',
    'class',
    'size',
    'variant',
  ]);

  const [status, setStatus] = createSignal<CopyStatus>('idle');
  let resetTimeout: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(resetTimeout));

  const idleLabel = () => local.label ?? 'Copy';
  const successLabel = () => local.successLabel ?? 'Copied';
  const failureLabel = () => local.failureLabel ?? "Couldn't copy";

  const currentLabel = () =>
    match(status())
      .with('idle', () => idleLabel())
      .with('success', () => successLabel())
      .with('failure', () => failureLabel())
      .exhaustive();

  const flash = (next: Exclude<CopyStatus, 'idle'>) => {
    setStatus(next);
    clearTimeout(resetTimeout);
    resetTimeout = setTimeout(
      () => setStatus('idle'),
      local.resetMs ?? DEFAULT_RESET_MS
    );
  };

  const writeText = (text: string | undefined): Promise<boolean> => {
    if (text === undefined || text.length === 0) return Promise.resolve(false);
    return writeClipboardData({ 'text/plain': text });
  };

  /** Start the clipboard write in this click turn so the user gesture is kept. */
  const startCopy = (): Promise<boolean> => {
    if (local.copy) {
      const result = local.copy();
      if (result && typeof result === 'object' && 'then' in result) {
        return (async () => (await result) !== false)();
      }
      return Promise.resolve(result !== false);
    }
    if (local.text === undefined) return Promise.resolve(false);
    const resolved =
      typeof local.text === 'function' ? local.text() : local.text;
    if (typeof resolved === 'string') return writeText(resolved);
    return (async () => await writeText(await resolved))();
  };

  const settle = async (pending: Promise<boolean>) => {
    try {
      const ok = await pending;
      flash(ok ? 'success' : 'failure');
      local.onCopied?.(ok);
    } catch {
      flash('failure');
      local.onCopied?.(false);
    }
  };

  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (e) => {
    const userOnClick = local.onClick;
    if (typeof userOnClick === 'function') userOnClick(e);
    try {
      void settle(startCopy());
    } catch {
      flash('failure');
      local.onCopied?.(false);
    }
  };

  return (
    <Button
      variant={local.variant ?? 'ghost'}
      size={local.size ?? (local.labeled ? 'sm' : 'icon-sm')}
      label={currentLabel()}
      tooltip={local.tooltip ?? currentLabel()}
      data-copy-status={status()}
      class={local.class}
      onClick={handleClick}
      {...rest}
    >
      <Switch>
        <Match when={status() === 'success'}>
          <CheckIcon class="text-success" />
        </Match>
        <Match when={status() === 'failure'}>
          <WarningIcon class="text-warning" />
        </Match>
        <Match when={status() === 'idle'}>
          <CopyIcon />
        </Match>
      </Switch>
      <Show when={local.labeled}>{currentLabel()}</Show>
    </Button>
  );
}
