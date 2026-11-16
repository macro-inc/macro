import { t } from '@app/lib/i18n';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import { openExternalUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import {
  type ClaudeSignInEntry,
  useClaudeCompleteMutation,
  useClaudeSignInMutation,
} from '@queries/computers/claude';
import { ActionDialogShell, Button, buttonClasses, Input } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { DisabledReason } from './computer-setup-dialog';

type Step = 'open' | 'code';

/**
 * Whether `url` is an https link. The sign-in link comes from the computer;
 * the server already allows only Claude's, and this keeps any other scheme
 * from ever being opened.
 */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Signs a computer's Claude Code in: open claude.ai in a new tab, then paste
 * the code it shows. Mounting asks for the computer's sign-in link, which is
 * the one it started ahead of time when there is one. Closing leaves that
 * sign-in waiting, so opening again shows the same link; harnessd ends it once
 * it is too old.
 *
 * Rendered as a dialog's body and footer; the host owns the dialog.
 */
export function ClaudeSignInFlow(props: {
  harnessId: string;
  /** Recorded on the sign-in's spans. */
  entry: ClaudeSignInEntry;
  onSignedIn: () => void;
  /** Offered at every step; absent when credits are not an option. */
  onUseCredits?: () => void;
  title?: string;
  /** Guided setup's step header and progress, above the title. */
  header?: JSX.Element;
  /** Closes the host dialog; absent where the host has its own way out. */
  onClose?: () => void;
}) {
  const start = useClaudeSignInMutation();
  const complete = useClaudeCompleteMutation();
  const codeId = createUniqueId();
  const [step, setStep] = createSignal<Step>('open');
  const [url, setUrl] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal<string>();
  // The label of the action that starts a fresh sign-in, when one is needed.
  const [restart, setRestart] = createSignal<string>();
  let request: AbortController | undefined;
  let generation = 0;
  // Clicked before the link arrived: the tab opened then, and is pointed at
  // claude.ai once the sign-in answers.
  let waitingTab: Window | null | undefined;

  const begin = async () => {
    const current = ++generation;
    request?.abort();
    request = new AbortController();
    setUrl(undefined);
    try {
      const result = await start.mutateAsync({
        harnessId: props.harnessId,
        entry: props.entry,
        signal: request.signal,
      });
      if (current !== generation) return;
      if (!isHttpsUrl(result.url)) throw new Error('untrusted sign-in link');
      setUrl(result.url);
      if (waitingTab) {
        // The Claude page gets no handle back to Macro.
        waitingTab.opener = null;
        waitingTab.location.href = result.url;
      }
      waitingTab = undefined;
    } catch (failure) {
      if (current !== generation) return;
      waitingTab?.close();
      waitingTab = undefined;
      setRestart(t('computers.claudeStartOver'));
      setError(
        thrownResultErrorHasCode(failure, 'CONFLICT')
          ? t('computers.claudeSignInConflict')
          : t('computers.claudeStartFailed')
      );
    }
  };
  fireAndForget(begin(), 'computer-claude');

  // A user who switched tabs sees in the tab strip that the link is ready.
  const pageTitle = document.title;
  createEffect(() => {
    document.title =
      url() && step() === 'open' ? t('computers.signInTabTitle') : pageTitle;
  });

  onCleanup(() => {
    document.title = pageTitle;
    generation++;
    request?.abort();
  });

  const startOver = () => {
    setError(undefined);
    setRestart(undefined);
    setCode('');
    setStep('open');
    fireAndForget(begin(), 'computer-claude');
  };

  // A plain new-tab link keeps the click a user gesture: the browser opens a
  // tab, and the desktop app hands new windows to the system browser. Only the
  // phone apps, which have no new-window handler, go through openExternalUrl.
  const openClaude = (event: MouseEvent) => {
    setStep('code');
    const href = url();
    if (href && !isNativeMobilePlatform()) return;
    event.preventDefault();
    if (href) openExternalUrl(href);
    else waitingTab = window.open('about:blank', '_blank');
  };

  const submit = async () => {
    if (!code().trim() || complete.isPending) return;
    const current = ++generation;
    request = new AbortController();
    setError(undefined);
    try {
      await complete.mutateAsync({
        harnessId: props.harnessId,
        entry: props.entry,
        code: code().trim(),
        signal: request.signal,
      });
      if (current !== generation) return;
      props.onSignedIn();
    } catch (failure) {
      if (current !== generation) return;
      setCode('');
      if (thrownResultErrorHasCode(failure, 'CLAUDE_INVALID_CODE')) {
        setRestart(t('computers.claudeTryAgain'));
        setError(t('computers.claudeInvalidCode'));
        return;
      }
      if (thrownResultErrorHasCode(failure, 'CLAUDE_SIGN_IN_EXPIRED')) {
        setRestart(t('computers.claudeStartOver'));
        setError(t('computers.claudeSignInExpired'));
        return;
      }
      setError(
        thrownResultErrorHasCode(failure, 'CONFLICT')
          ? t('computers.claudeSignInConflict')
          : t('computers.claudeCompleteFailed')
      );
    }
  };

  return (
    <>
      <ActionDialogShell.Body>
        {props.header}
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {props.title ?? t('computers.claudeSignInTitle')}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {t('computers.claudeSignInSteps')}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <p class="text-sm text-ink-muted">
          {t('computers.claudeSharedAccount')}
        </p>
        <Show when={step() === 'code'}>
          <p class="text-sm text-ink-muted">
            {t('computers.claudeHarnessNote')}
          </p>
        </Show>
        <Show when={step() === 'code'}>
          <form
            class="ph-no-capture flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(submit(), 'computer-claude');
            }}
          >
            <label for={codeId} class="text-sm leading-5 text-ink-muted">
              {t('computers.claudeCodeLabel')}
            </label>
            <Input
              id={codeId}
              ref={(input) => queueMicrotask(() => input.focus())}
              value={code()}
              disabled={!!restart()}
              onInput={(event) => setCode(event.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
          </form>
        </Show>
        <Show when={error()}>
          {(message) => (
            <p role="alert" class="text-sm text-failure">
              {message()}
            </p>
          )}
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Show when={props.onClose}>
          {(close) => (
            <Button type="button" variant="ghost" onClick={close()}>
              {t('common.close')}
            </Button>
          )}
        </Show>
        {/* Offered at every step, failed ones too; not while a pasted code is
            being checked, which may still sign the computer in. */}
        <Show when={props.onUseCredits}>
          {(useCredits) => (
            <Button
              type="button"
              variant="ghost"
              disabled={complete.isPending}
              onClick={useCredits()}
            >
              {t('computers.claudeUseCreditsInstead')}
            </Button>
          )}
        </Show>
        <Switch>
          <Match when={restart()}>
            {(label) => (
              <Button type="button" variant="primary" onClick={startOver}>
                {label()}
              </Button>
            )}
          </Match>
          <Match when={step() === 'open'}>
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              class={buttonClasses({ variant: 'primary', size: 'md' })}
              onClick={openClaude}
            >
              {t('computers.openClaudeSignIn')}
              <ArrowSquareOutIcon class="size-3.5 shrink-0" />
            </a>
          </Match>
          <Match when={step() === 'code'}>
            <Button
              type="button"
              variant="primary"
              disabled={complete.isPending || !code().trim()}
              onClick={() => fireAndForget(submit(), 'computer-claude')}
            >
              {t('computers.completeSignIn')}
            </Button>
            <Show when={!code().trim()}>
              <DisabledReason>
                {t('computers.pasteCodeToContinue')}
              </DisabledReason>
            </Show>
          </Match>
        </Switch>
      </ActionDialogShell.Footer>
    </>
  );
}
