import { t } from '@app/lib/i18n';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import {
  type ClaudeSignInEntry,
  useClaudeCompleteMutation,
  useClaudeSignInMutation,
} from '@queries/computers/claude';
import {
  ActionDialogShell,
  Button,
  buttonClasses,
  cn,
  Input,
  Spinner,
} from '@ui';
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

function failureMessage(failure: ClaudeSignInFailure): string {
  return match(failure)
    .with('expired', () => t('computers.claudeSignInExpired'))
    .with('invalid_code', () => t('computers.claudeInvalidCode'))
    .with('malformed_code', () => t('computers.claudeMalformedCode'))
    .with('unreachable', () => t('computers.claudeUnreachable'))
    .with('busy', () => t('computers.claudeBusy'))
    .with('timeout', () => t('computers.claudeTimedOut'))
    .with('failed', () => t('computers.claudeFailed'))
    .exhaustive();
}

/** One numbered step: what to do, and the control that does it. */
function SignInStep(props: {
  number: number;
  done: boolean;
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
        <p class="text-sm leading-6 font-medium">{props.title}</p>
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
  onSignedIn: () => void;
  title?: string;
  /** One line under the title; defaults to the computer's. */
  description?: string;
  /** Small print under the steps: who can use the sign-in. */
  footnote?: string;
  /** Guided setup's step header and progress, above the title. */
  header?: JSX.Element;
  /** The secondary way out, e.g. "Keep using Macro credits". */
  secondary?: { label: string; onClick: () => void };
}) {
  const start = useClaudeSignInMutation();
  const complete = useClaudeCompleteMutation();
  const codeId = createUniqueId();
  const [opened, setOpened] = createSignal(false);
  const [url, setUrl] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [problem, setProblem] = createSignal<Problem>();
  let request: AbortController | undefined;
  let generation = 0;
  let codeInput: HTMLInputElement | undefined;
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
      setOpened(false);
      setProblem({
        failure: claudeSignInFailure(failure),
        recovery: 'retry',
      });
    }
  };
  fireAndForget(begin(), 'computer-claude');

  // A user who switched tabs sees in the tab strip that the link is ready.
  const pageTitle = document.title;
  const markTab = (ready: boolean) => {
    document.title = ready ? t('computers.signInTabTitle') : pageTitle;
  };

  onCleanup(() => {
    document.title = pageTitle;
    generation++;
    request?.abort();
  });

  /** A new sign-in: a new link, and the code from it. */
  const startOver = () => {
    setProblem(undefined);
    setCode('');
    setOpened(false);
    markTab(false);
    fireAndForget(begin(), 'computer-claude');
  };

  // A plain new-tab link keeps the click a user gesture: the browser opens a
  // tab, and the desktop app hands new windows to the system browser. Only the
  // phone apps, which have no new-window handler, go through openExternalUrl.
  const openClaude = (event: MouseEvent) => {
    setOpened(true);
    markTab(true);
    queueMicrotask(() => codeInput?.focus());
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
    setProblem(undefined);
    try {
      await complete.mutateAsync({
        harnessId: props.harnessId,
        entry: props.entry,
        code: code().trim(),
        signal: request.signal,
      });
      if (current !== generation) return;
      markTab(false);
      props.onSignedIn();
    } catch (failure) {
      if (current !== generation) return;
      const kind = claudeSignInFailure(failure);
      const recovery = claudeSignInRecovery('complete', kind);
      if (recovery === 'new_link') setCode('');
      setProblem({ failure: kind, recovery });
    }
  };

  /** A failure that needs a new link has nothing left to paste into. */
  const needsNewLink = () => {
    const current = problem();
    return !!current && current.recovery !== 'repaste';
  };

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
              <a
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={needsNewLink() || undefined}
                class={cn(
                  buttonClasses({
                    variant: opened() ? 'secondary' : 'primary',
                    size: 'md',
                  }),
                  needsNewLink() && 'pointer-events-none opacity-45'
                )}
                onClick={openClaude}
              >
                <Show
                  when={url() || needsNewLink()}
                  fallback={<Spinner size="sm" decorative />}
                >
                  <ArrowSquareOutIcon class="size-3.5 shrink-0" />
                </Show>
                {opened()
                  ? t('computers.openClaudeAgain')
                  : t('computers.openClaudeSignIn')}
              </a>
            </div>
          </SignInStep>
          <SignInStep
            number={2}
            done={false}
            title={t('computers.claudeStepPaste')}
          >
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
                class="min-w-0 flex-1 font-mono max-sm:flex-none"
                placeholder={t('computers.claudeCodePlaceholder')}
                value={code()}
                disabled={needsNewLink() || complete.isPending}
                aria-invalid={
                  problem()?.failure === 'malformed_code' || undefined
                }
                onInput={(event) => setCode(event.currentTarget.value)}
                autocomplete="off"
                spellcheck={false}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!code().trim() || needsNewLink()}
                loading={complete.isPending}
              >
                {t('computers.completeSignIn')}
              </Button>
            </form>
          </SignInStep>
        </ol>
        <Show when={problem()}>
          {(current) => (
            <div
              role="alert"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-failure/8 px-3 py-2 text-sm text-failure"
            >
              <span class="min-w-0 flex-1">
                {failureMessage(current().failure)}
              </span>
              <Switch>
                <Match when={current().recovery === 'new_link'}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={startOver}
                  >
                    {t('computers.claudeNewLink')}
                  </Button>
                </Match>
                <Match when={current().recovery === 'retry'}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={startOver}
                  >
                    {t('computers.claudeTryAgain')}
                  </Button>
                </Match>
              </Switch>
            </div>
          )}
        </Show>
        <Show when={props.footnote}>
          {(text) => <p class="text-xs text-ink-muted">{text()}</p>}
        </Show>
      </ActionDialogShell.Body>
      <Show when={props.secondary}>
        {(secondary) => (
          <ActionDialogShell.Footer>
            {/* Not while a pasted code is being checked, which may still
                sign the computer in. */}
            <Button
              type="button"
              variant="ghost"
              disabled={complete.isPending}
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
