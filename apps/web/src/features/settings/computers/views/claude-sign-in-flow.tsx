import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { reserveOauthPopup } from '@core/pipedream/oauth-popup';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import {
  type ClaudeSignInEntry,
  useClaudeCompleteMutation,
  useClaudeSignInMutation,
} from '@queries/computers/claude';
import { ActionDialogShell, Button, buttonClasses, cn, Input } from '@ui';
import {
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ClaudeSignInFailure,
  type ClaudeSignInRecovery,
  claudeSignInFailure,
  claudeSignInRecovery,
} from '../core/claude-sign-in-failure';

/** A failure on screen and its way out. */
type Problem = {
  phase: 'start' | 'complete';
  failure: ClaudeSignInFailure;
  recovery: ClaudeSignInRecovery;
};

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

function failureMessage(
  phase: Problem['phase'],
  failure: ClaudeSignInFailure
): string {
  // No link existed yet: only a reason the computer can't answer, or won't
  // for this account or caller, says more.
  if (
    phase === 'start' &&
    failure !== 'unreachable' &&
    failure !== 'busy' &&
    failure !== 'rollout_disabled' &&
    failure !== 'forbidden'
  )
    return t('computers.claudeLinkFailed');
  return match(failure)
    .with('expired', () => t('computers.claudeSignInExpired'))
    .with('invalid_code', () => t('computers.claudeInvalidCode'))
    .with('malformed_code', () => t('computers.claudeMalformedCode'))
    .with('unreachable', () => t('computers.claudeUnreachable'))
    .with('busy', () => t('computers.claudeBusy'))
    .with('timeout', () => t('computers.claudeTimedOut'))
    .with('rollout_disabled', () => t('computers.rolloutDisabled'))
    .with('forbidden', () => t('computers.errorForbidden'))
    .with('failed', () => t('computers.claudeFailed'))
    .exhaustive();
}

/** One numbered step: what to do, and the control that does it. */
function SignInStep(props: {
  number: number;
  done?: boolean;
  title: string;
  children: JSX.Element;
}) {
  return (
    <li class="flex gap-3">
      <span
        aria-hidden="true"
        class={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          props.done ? 'bg-success/15 text-success' : 'bg-ink/8 text-ink-muted'
        )}
      >
        <Show when={props.done} fallback={props.number}>
          <CheckIcon class="size-3" />
        </Show>
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <p class="text-sm leading-6 font-medium">
          {props.title}
          <Show when={props.done}>
            <span class="sr-only"> ({t('computers.claudeStepDone')})</span>
          </Show>
        </p>
        {props.children}
      </div>
    </li>
  );
}

/**
 * Signs a computer's Claude Code in to a Claude plan, in two steps on one
 * screen: open claude.ai, then paste the code it shows. Mounting asks the
 * computer for its sign-in link, which is the one it started ahead of time
 * when there is one. Closing leaves that sign-in waiting, so opening again
 * shows the same link; harnessd ends it once it is too old.
 *
 * Rendered as a dialog's body and footer; the host owns the dialog.
 */
export function ClaudeSignInFlow(props: {
  harnessId: string;
  /** Recorded on the sign-in's spans. */
  entry: ClaudeSignInEntry;
  /** `closed`: the dialog closed while the computer checked the code. */
  onSignedIn: (closed: boolean) => void;
  title?: string;
  /** One line under the title; defaults to the computer's. */
  description?: string;
  /** Small print under the steps: who can use the sign-in. */
  footnote?: string;
  /** Guided setup's step header and progress, above the title. */
  header?: JSX.Element;
  /** The secondary way out, e.g. "Keep using Macro credits". */
  secondary?: { label: string; pending?: boolean; onClick: () => void };
}) {
  const start = useClaudeSignInMutation();
  const complete = useClaudeCompleteMutation();
  const codeId = createUniqueId();
  const alertId = createUniqueId();
  const [opened, setOpened] = createSignal(false);
  const [url, setUrl] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [problem, setProblem] = createSignal<Problem>();
  // The link request and the code check run independently: a code sent
  // while a new link loads must not drop that link.
  let linkRequest: AbortController | undefined;
  let linkGeneration = 0;
  let codeGeneration = 0;
  let disposed = false;
  let codeInput: HTMLInputElement | undefined;
  let recoveryButton: HTMLButtonElement | undefined;
  // Opened before the link arrived. On the web the tab opened within the
  // click and is pointed at claude.ai once the sign-in answers; the phone
  // apps open the link when it arrives.
  let waitingTab: Window | undefined;
  let openWhenReady = false;

  const forgetWaitingTab = () => {
    waitingTab?.close();
    waitingTab = undefined;
    openWhenReady = false;
  };

  const begin = async () => {
    const current = ++linkGeneration;
    linkRequest?.abort();
    linkRequest = new AbortController();
    setUrl(undefined);
    try {
      const result = await start.mutateAsync({
        harnessId: props.harnessId,
        entry: props.entry,
        signal: linkRequest.signal,
      });
      if (current !== linkGeneration) return;
      if (!isHttpsUrl(result.url)) throw new Error('untrusted sign-in link');
      setUrl(result.url);
      // A tab the user closed meanwhile stays closed.
      if (waitingTab && !waitingTab.closed)
        waitingTab.location.href = result.url;
      else if (openWhenReady) openExternalUrl(result.url);
      waitingTab = undefined;
      openWhenReady = false;
    } catch (failure) {
      if (current !== linkGeneration) return;
      forgetWaitingTab();
      resetOpened();
      const kind = claudeSignInFailure(failure);
      showProblem({
        phase: 'start',
        failure: kind,
        recovery: claudeSignInRecovery('start', kind),
      });
    }
  };
  fireAndForget(begin(), 'computer-claude');

  // A user who went to claude.ai sees in the tab strip that Macro waits
  // for the code.
  const pageTitle = document.title;
  const markTab = (waiting: boolean) => {
    if (waiting) document.title = t('computers.signInTabTitle');
    // Only undo our own title; the page may have set a newer one.
    else if (document.title === t('computers.signInTabTitle'))
      document.title = pageTitle;
  };

  onCleanup(() => {
    disposed = true;
    markTab(false);
    linkGeneration++;
    linkRequest?.abort();
    forgetWaitingTab();
    // A code being checked is left to finish: it may still sign the
    // computer in, and its success toast says so.
  });

  /** Show a failure and move focus to where the user recovers from it. */
  const showProblem = (next: Problem) => {
    setProblem(next);
    queueMicrotask(() => {
      match(next.recovery)
        .with('repaste', () => codeInput?.focus())
        .with('retry', 'new_link', () => recoveryButton?.focus())
        // No action to move to: the alert is announced where it is.
        .with('none', () => undefined)
        .exhaustive();
    });
  };

  /** Step one undone: the tab no longer waits for a code. */
  function resetOpened() {
    setOpened(false);
    markTab(false);
  }

  /** A new sign-in: a new link, and the code from it. */
  const startOver = () => {
    setProblem(undefined);
    setCode('');
    resetOpened();
    fireAndForget(begin(), 'computer-claude');
  };

  /** A failure that needs a new link, or has no way out, has nothing left
   * to paste into. */
  const needsNewLink = () => {
    const current = problem();
    return !!current && current.recovery !== 'repaste';
  };

  const afterOpening = () => {
    setOpened(true);
    markTab(true);
    queueMicrotask(() => codeInput?.focus());
  };

  // A plain new-tab link keeps the click a user gesture: the browser opens a
  // tab, and the desktop app hands new windows to the system browser. Only the
  // phone apps, which have no new-window handler, go through openExternalUrl.
  const openLink = (event: MouseEvent, href: string) => {
    afterOpening();
    if (!isNativeMobilePlatform()) return;
    event.preventDefault();
    openExternalUrl(href);
  };

  // Clicked before the link arrived. A browser opens the tab now, within
  // the click, and points it at claude.ai later; the apps, where a blank tab
  // would land in the system browser, open the link once it arrives.
  const openBeforeLink = () => {
    if (isNativeMobilePlatform() || isTauri()) {
      openWhenReady = true;
      afterOpening();
      return;
    }
    // A blocked popup opens nothing, so the step stays undone.
    waitingTab = reserveOauthPopup() ?? undefined;
    if (waitingTab) afterOpening();
  };

  const submit = async () => {
    if (!code().trim() || complete.isPending || start.isPending) return;
    const current = ++codeGeneration;
    setProblem(undefined);
    try {
      await complete.mutateAsync({
        harnessId: props.harnessId,
        entry: props.entry,
        code: code().trim(),
      });
      if (current !== codeGeneration) return;
      if (!disposed) markTab(false);
      props.onSignedIn(disposed);
    } catch (failure) {
      if (current !== codeGeneration) return;
      const kind = claudeSignInFailure(failure);
      // Closed while the computer checked: the dialog can't say it failed.
      if (disposed) {
        toast.failure(t('computers.claudeFailedAfterClose'));
        return;
      }
      const recovery = claudeSignInRecovery('complete', kind);
      if (recovery === 'new_link') {
        setCode('');
        resetOpened();
      }
      showProblem({ phase: 'complete', failure: kind, recovery });
    }
  };

  const hasCode = () => !!code().trim();

  return (
    <>
      <ActionDialogShell.Body class="space-y-5">
        {props.header}
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {props.title ?? t('computers.claudeSignInTitle')}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {props.description ?? t('computers.claudeSignInDescription')}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <ol class="flex flex-col gap-4">
          <SignInStep
            number={1}
            done={opened() && !needsNewLink()}
            title={t('computers.claudeStepOpen')}
          >
            <div>
              <Switch>
                <Match when={!needsNewLink() && url()}>
                  {(href) => (
                    <a
                      href={href()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class={buttonClasses({
                        variant: opened() ? 'secondary' : 'primary',
                        size: 'md',
                      })}
                      onClick={(event) => openLink(event, href())}
                    >
                      <ArrowSquareOutIcon class="size-3.5 shrink-0" />
                      {opened()
                        ? t('computers.openClaudeAgain')
                        : t('computers.openClaudeSignIn')}
                    </a>
                  )}
                </Match>
                <Match when={true}>
                  {/* No link yet, or none to use: a button, so it stays a
                      keyboard stop while the link loads. */}
                  <Button
                    type="button"
                    variant={opened() ? 'secondary' : 'primary'}
                    disabled={needsNewLink()}
                    loading={!needsNewLink() && opened() && start.isPending}
                    onClick={openBeforeLink}
                  >
                    <ArrowSquareOutIcon class="size-3.5 shrink-0" />
                    {opened()
                      ? t('computers.openClaudeAgain')
                      : t('computers.openClaudeSignIn')}
                  </Button>
                </Match>
              </Switch>
            </div>
            {/* Always rendered, so the dialog keeps its height as the
                link arrives. */}
            <p class="min-h-4 text-xs text-ink-muted" aria-live="polite">
              <Show when={!needsNewLink() && !opened() && start.isPending}>
                {t('computers.claudePreparingLink')}
              </Show>
            </p>
          </SignInStep>
          <SignInStep number={2} title={t('computers.claudeStepPaste')}>
            <form
              class="ph-no-capture flex gap-2 max-sm:flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                fireAndForget(submit(), 'computer-claude');
              }}
            >
              <label for={codeId} class="sr-only">
                {t('computers.claudeCodeLabel')}
              </label>
              <Input
                id={codeId}
                ref={(input) => {
                  codeInput = input;
                }}
                class="min-w-0 flex-1 max-sm:flex-none"
                placeholder={t('computers.claudeCodePlaceholder')}
                value={code()}
                readOnly={complete.isPending}
                disabled={needsNewLink()}
                aria-invalid={
                  problem()?.failure === 'malformed_code' || undefined
                }
                aria-describedby={problem() ? alertId : undefined}
                onInput={(event) => setCode(event.currentTarget.value)}
                autocomplete="off"
                spellcheck={false}
              />
              <Button
                type="submit"
                variant={hasCode() ? 'primary' : 'secondary'}
                disabled={!hasCode() || needsNewLink() || start.isPending}
                loading={complete.isPending}
              >
                {t('computers.completeSignIn')}
              </Button>
            </form>
            <Show when={complete.isPending}>
              <p class="text-xs text-ink-muted" aria-live="polite">
                {t('computers.claudeChecking')}
              </p>
            </Show>
          </SignInStep>
        </ol>
        <Show when={problem()}>
          {(current) => (
            <div
              role="alert"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-failure/8 px-3 py-2 text-sm text-failure max-sm:flex-col max-sm:items-stretch"
            >
              <span id={alertId} class="min-w-0 flex-1">
                {failureMessage(current().phase, current().failure)}
              </span>
              <Show
                when={
                  current().recovery === 'retry' ||
                  current().recovery === 'new_link'
                }
              >
                <Button
                  ref={(button: HTMLButtonElement) => {
                    recoveryButton = button;
                  }}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={startOver}
                >
                  {current().recovery === 'new_link'
                    ? t('computers.claudeNewLink')
                    : t('computers.claudeTryAgain')}
                </Button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.footnote}>
          {(text) => <p class="text-xs text-ink-muted">{text()}</p>}
        </Show>
      </ActionDialogShell.Body>
      <Show when={props.secondary}>
        {(secondary) => (
          <ActionDialogShell.Footer class="max-sm:justify-stretch">
            {/* Not while a pasted code is being checked, which may still
                sign the computer in. */}
            <Button
              type="button"
              variant="ghost"
              class="max-sm:flex-1"
              disabled={complete.isPending}
              loading={secondary().pending}
              onClick={secondary().onClick}
            >
              {secondary().label}
            </Button>
          </ActionDialogShell.Footer>
        )}
      </Show>
    </>
  );
}
