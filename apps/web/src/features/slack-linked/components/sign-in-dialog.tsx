import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import KeyIcon from '@phosphor/key.svg';
import ShieldIcon from '@phosphor/shield-check.svg';
import {
  ActionDialogShell,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Spinner,
  TextField,
} from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { DesktopSignIn } from '../context/slack-linked-context';
import {
  initiallyPicked,
  loginFailureMessage,
  normalizeEmail,
  normalizeEmailCode,
  normalizeTwoFactorCode,
  parsePastedSession,
  pastedSessionProblemMessage,
  pickLabel,
  type SlackLoginStep,
  type SlackLoginWorkspace,
} from '../core/login';
import type { SignInFlow } from '../primitives/sign-in-flow';

/** The dialog's header and footer around one step's fields. */
function StepForm(props: {
  title: string;
  description: JSX.Element;
  failure: string | undefined;
  pending: boolean;
  /** The step's submit button; absent for steps nobody submits. */
  submit?: { label: string; disabled?: boolean };
  /** Beside Cancel, such as Back. */
  secondary?: JSX.Element;
  onSubmit?: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  children?: JSX.Element;
}) {
  return (
    <form
      class="flex min-h-0 flex-col"
      aria-busy={props.pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!props.pending && !props.submit?.disabled) props.onSubmit?.();
      }}
    >
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>{props.title}</ActionDialogShell.Title>
          <ActionDialogShell.Description as="div">
            {props.description}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        {props.children}
        <Show when={props.failure}>
          <p role="alert" class="text-sm text-failure-ink">
            {props.failure}
          </p>
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        {props.secondary}
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {props.cancelLabel ?? 'Cancel'}
        </Button>
        <Show when={props.submit}>
          {(submit) => (
            <Button
              type="submit"
              variant="primary"
              disabled={props.pending || submit().disabled}
            >
              {submit().label}
            </Button>
          )}
        </Show>
      </ActionDialogShell.Footer>
    </form>
  );
}

function Working(props: { children: string }) {
  return (
    <p role="status" class="flex items-center gap-2 text-sm text-ink-muted">
      <Spinner class="size-4" />
      {props.children}
    </p>
  );
}

/** "Sign in with browser" for desktop, or the way to get there. */
function BrowserOption(props: {
  desktop: DesktopSignIn;
  pending: boolean;
  onSignIn: () => void;
  onHandOff: () => void;
}) {
  return (
    <Switch>
      <Match when={props.desktop.kind === 'native'}>
        <div class="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="secondary"
            disabled={props.pending}
            onClick={props.onSignIn}
          >
            <ArrowSquareOutIcon class="size-3.5" />
            Sign in with browser
          </Button>
          <span class="text-xs text-ink-extra-muted">
            For workspaces that use SSO. Slack opens in a separate Macro window
            with its own cookies.
          </span>
        </div>
      </Match>
      <Match
        when={props.desktop.kind === 'handoff' ? props.desktop : undefined}
      >
        {(handoff) => (
          <p class="text-xs text-ink-extra-muted">
            Workspace uses SSO?{' '}
            <a
              href={handoff().desktopUrl(undefined)}
              onClick={props.onHandOff}
              class="font-medium text-ink underline underline-offset-2"
            >
              Sign in from Macro desktop
            </a>
            .
          </p>
        )}
      </Match>
      <Match when={props.desktop.kind === 'unsupported'}>
        <p class="text-xs text-ink-extra-muted">
          Workspaces that use SSO sign in from Macro on a computer.
        </p>
      </Match>
    </Switch>
  );
}

/** Slack asks for something only slack.com itself can show. */
function DesktopOnly(props: {
  desktop: DesktopSignIn;
  loginId: string;
  /** What to do on desktop, e.g. "Verify on slack.com". */
  action: string;
  pending: boolean;
  onNative: () => void;
  onHandOff: () => void;
}) {
  return (
    <Switch>
      <Match when={props.desktop.kind === 'native'}>
        <Button
          type="button"
          variant="primary"
          class="self-start"
          disabled={props.pending}
          onClick={props.onNative}
        >
          <ArrowSquareOutIcon class="size-3.5" />
          {props.action}
        </Button>
      </Match>
      <Match
        when={props.desktop.kind === 'handoff' ? props.desktop : undefined}
      >
        {(handoff) => (
          <a
            href={handoff().desktopUrl(props.loginId)}
            onClick={props.onHandOff}
            class="self-start text-sm font-medium text-ink underline underline-offset-2"
          >
            Continue on Macro desktop
          </a>
        )}
      </Match>
      <Match when={props.desktop.kind === 'unsupported'}>
        <p role="alert" class="text-sm text-ink-muted">
          Only Macro desktop can show this Slack page. Sign in from Macro on
          your computer.
        </p>
      </Match>
    </Switch>
  );
}

function WorkspacePicker(props: {
  workspaces: SlackLoginWorkspace[];
  picked: readonly string[];
  onPickedChange: (teamIds: string[]) => void;
}) {
  const toggle = (teamId: string, on: boolean) =>
    props.onPickedChange(
      on
        ? [...props.picked, teamId]
        : props.picked.filter((id) => id !== teamId)
    );
  return (
    <div class="flex max-h-80 flex-col divide-y divide-edge-muted overflow-y-auto rounded-lg border border-edge-muted">
      <For each={props.workspaces}>
        {(workspace) => (
          <Checkbox
            class="flex w-full items-start gap-3 px-3 py-2.5"
            checked={props.picked.includes(workspace.teamId)}
            onChange={(on: boolean) => toggle(workspace.teamId, on)}
            data-slack-workspace={workspace.teamId}
          >
            <Checkbox.Input />
            <Checkbox.Control class="mt-0.5" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <Checkbox.Label class="flex items-center gap-2 text-sm font-medium text-ink">
                <span class="ph-no-capture truncate">{workspace.name}</span>
                <Show when={workspace.enterpriseName}>
                  <Badge variant="secondary" size="xs">
                    Enterprise Grid
                  </Badge>
                </Show>
                <Show when={workspace.alreadyConnected}>
                  <Badge variant="outline" size="xs">
                    Connected
                  </Badge>
                </Show>
              </Checkbox.Label>
              <span class="truncate text-xs text-ink-extra-muted">
                {workspace.domain}
                {match(workspace.signIn)
                  .with('ready', () => '')
                  .with('two_factor', () => ' · asks for a two-factor code')
                  .with('sso', () => ' · SSO: finish in Macro desktop')
                  .exhaustive()}
              </span>
              <Show when={workspace.enterpriseName}>
                {(enterprise) => (
                  <span class="flex items-start gap-1 text-xs text-ink-muted">
                    <ShieldIcon
                      class="mt-px size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    Part of {enterprise()} on Enterprise Grid: its admins may
                    see Macro as a signed-in session.
                  </span>
                )}
              </Show>
            </span>
          </Checkbox>
        )}
      </For>
    </div>
  );
}

/**
 * Signing in to Slack: email and Slack's emailed code first (web, desktop and
 * phones), Slack's own page in a Macro desktop window for SSO and captchas,
 * and a pasted token and cookie under Advanced. Codes and sessions stay in
 * this `ph-no-capture` dialog.
 */
export function SignInDialog(props: {
  flow: SignInFlow;
  desktop: DesktopSignIn;
}) {
  const flow = props.flow;
  const [email, setEmail] = createSignal('');
  const [code, setCode] = createSignal('');
  const [twoFactor, setTwoFactor] = createSignal('');
  const [picked, setPicked] = createSignal<string[]>();
  const [pasted, setPasted] = createSignal({
    tokens: '',
    cookie: '',
    cookieDs: '',
  });
  const run = (work: Promise<unknown> | undefined) =>
    fireAndForget(Promise.resolve(work), 'slack-linked.sign-in');
  const cancel = () => {
    setCode('');
    setTwoFactor('');
    setPicked(undefined);
    setPasted({ tokens: '', cookie: '', cookieDs: '' });
    flow.close();
  };
  const loginId = () => {
    const phase = flow.phase();
    return phase.kind === 'login' ? phase.loginId : '';
  };
  const common = () => ({
    failure: flow.failure(),
    pending: flow.pending(),
    onCancel: cancel,
  });

  const loginStep = (step: SlackLoginStep) =>
    match(step)
      .with({ kind: 'working' }, () => (
        <StepForm {...common()} title="Sign in to Slack" description="">
          <Working>Checking with Slack…</Working>
        </StepForm>
      ))
      .with({ kind: 'captcha' }, (captcha) => (
        <StepForm
          {...common()}
          title="Verify with Slack"
          description="Slack wants to check you're not a robot before it emails your code."
        >
          <Show when={captcha.retry}>
            <p role="alert" class="text-sm text-failure-ink">
              Slack didn't accept that check. Try it again.
            </p>
          </Show>
          <DesktopOnly
            desktop={props.desktop}
            loginId={loginId()}
            action="Verify on slack.com"
            pending={flow.pending()}
            onNative={() =>
              run(flow.solveCaptcha(captcha.siteKey, captcha.pageUrl))
            }
            onHandOff={flow.handOff}
          />
        </StepForm>
      ))
      .with({ kind: 'email_code' }, (step) => (
        <StepForm
          {...common()}
          title="Check your email"
          description={
            <>
              Slack sent a code to{' '}
              <span class="ph-no-capture font-medium text-ink">
                {step.email}
              </span>
              .
            </>
          }
          submit={{
            label: flow.pending() ? 'Checking…' : 'Continue',
            disabled: !normalizeEmailCode(code()),
          }}
          onSubmit={() => {
            const value = normalizeEmailCode(code());
            if (value) run(flow.answer({ step: 'code', code: value }));
          }}
        >
          <TextField
            value={code()}
            onChange={setCode}
            validationState={step.retry ? 'invalid' : 'valid'}
          >
            <TextField.Label>Confirmation code</TextField.Label>
            <TextField.Input
              autocomplete="one-time-code"
              placeholder="ABC-123"
              readOnly={flow.pending()}
              autofocus
            />
            <TextField.ErrorMessage>
              That code didn't work. Check it and try again.
            </TextField.ErrorMessage>
          </TextField>
        </StepForm>
      ))
      .with({ kind: 'pick_workspaces' }, (step) => {
        const chosen = () => picked() ?? initiallyPicked(step.workspaces);
        return (
          <StepForm
            {...common()}
            title="Choose workspaces"
            description="Macro lists only Slack Connect conversations from these workspaces, and nothing syncs until you add one."
            submit={{
              label: pickLabel(chosen().length),
              disabled: chosen().length === 0,
            }}
            onSubmit={() =>
              run(flow.answer({ step: 'workspaces', teamIds: chosen() }))
            }
          >
            <WorkspacePicker
              workspaces={step.workspaces}
              picked={chosen()}
              onPickedChange={setPicked}
            />
          </StepForm>
        );
      })
      .with({ kind: 'two_factor' }, (step) => (
        <StepForm
          {...common()}
          title="Two-factor code"
          description={
            <>
              <span class="ph-no-capture">{step.team.name}</span> asks for the
              six-digit code from your authenticator app.
            </>
          }
          submit={{
            label: flow.pending() ? 'Checking…' : 'Continue',
            disabled: !normalizeTwoFactorCode(twoFactor()),
          }}
          onSubmit={() => {
            const value = normalizeTwoFactorCode(twoFactor());
            if (value) {
              setTwoFactor('');
              run(flow.answer({ step: 'two_factor', code: value }));
            }
          }}
        >
          <TextField
            value={twoFactor()}
            onChange={setTwoFactor}
            validationState={step.retry ? 'invalid' : 'valid'}
          >
            <TextField.Label>Code</TextField.Label>
            <TextField.Input
              inputMode="numeric"
              autocomplete="one-time-code"
              placeholder="123456"
              readOnly={flow.pending()}
              autofocus
            />
            <TextField.ErrorMessage>
              That code didn't work. Try the current one.
            </TextField.ErrorMessage>
          </TextField>
        </StepForm>
      ))
      .with({ kind: 'finish_on_desktop' }, (step) => (
        <StepForm
          {...common()}
          title="Finish with SSO"
          description={
            <>
              <span class="ph-no-capture">{step.team.name}</span> signs in
              through your company's SSO, which only Slack's own page can show.
              Your other workspaces keep signing in.
            </>
          }
        >
          <DesktopOnly
            desktop={props.desktop}
            loginId={loginId()}
            action="Sign in with browser"
            pending={flow.pending()}
            onNative={() => run(flow.signInWithBrowser(step.signInUrl))}
            onHandOff={flow.handOff}
          />
        </StepForm>
      ))
      .with({ kind: 'done' }, (step) => (
        <StepForm
          {...common()}
          title="Slack connected"
          cancelLabel="Done"
          description={
            step.accounts.length
              ? `Connected ${step.accounts.map((account) => account.teamName).join(', ')}. Add Slack Connect conversations from the list.`
              : 'No workspace was connected.'
          }
        >
          <Show when={step.skipped.length}>
            <p class="text-sm text-ink-muted">
              Still to finish with SSO in Macro desktop:{' '}
              <span class="ph-no-capture">
                {step.skipped.map((workspace) => workspace.name).join(', ')}
              </span>
              .
            </p>
          </Show>
        </StepForm>
      ))
      .with({ kind: 'failed' }, (step) => (
        <StepForm
          {...common()}
          title="Sign in to Slack"
          description=""
          secondary={
            <Button type="button" variant="secondary" onClick={flow.restart}>
              Start again
            </Button>
          }
        >
          <p role="alert" class="text-sm text-ink-muted">
            {loginFailureMessage(step.reason)}
          </p>
        </StepForm>
      ))
      .with({ kind: 'cancelled' }, () => (
        <StepForm
          {...common()}
          title="Sign in to Slack"
          description=""
          secondary={
            <Button type="button" variant="secondary" onClick={flow.restart}>
              Start again
            </Button>
          }
        >
          <p role="alert" class="text-sm text-ink-muted">
            This sign-in was cancelled.
          </p>
        </StepForm>
      ))
      .exhaustive();

  return (
    <Dialog
      open={flow.open()}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      position="center"
      class="ph-no-capture w-120"
      visibleScrim
    >
      <ActionDialogShell>
        <Switch>
          <Match when={flow.phase().kind === 'start'}>
            <StepForm
              {...common()}
              title="Sign in to Slack"
              description="Use the email address you sign in to Slack with. Slack emails you a code."
              submit={{
                label: flow.pending() ? 'Sending…' : 'Continue',
                disabled: !normalizeEmail(email()),
              }}
              onSubmit={() => {
                const value = normalizeEmail(email());
                if (value) run(flow.submitEmail(value));
              }}
            >
              <TextField value={email()} onChange={setEmail}>
                <TextField.Label>Email</TextField.Label>
                <TextField.Input
                  type="email"
                  inputMode="email"
                  autocomplete="email"
                  readOnly={flow.pending()}
                  autofocus
                />
              </TextField>
              <BrowserOption
                desktop={props.desktop}
                pending={flow.pending()}
                onSignIn={() => run(flow.signInWithBrowser(undefined))}
                onHandOff={flow.handOff}
              />
              <details class="text-sm text-ink-muted">
                <summary class="cursor-default text-xs text-ink-extra-muted">
                  Advanced
                </summary>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="mt-1"
                  onClick={flow.showPaste}
                >
                  <KeyIcon class="size-3.5" />
                  Paste token and cookie
                </Button>
              </details>
            </StepForm>
          </Match>
          <Match when={flow.phase().kind === 'paste'}>
            {(() => {
              const parsed = () => parsePastedSession(pasted());
              const set =
                (field: 'tokens' | 'cookie' | 'cookieDs') =>
                (value: string) => {
                  flow.setFailure(undefined);
                  setPasted((current) => ({ ...current, [field]: value }));
                };
              return (
                <StepForm
                  {...common()}
                  title="Paste token and cookie"
                  description="From a browser signed in to Slack: each workspace's xoxc- token (localStorage localConfig_v2) and the d cookie of app.slack.com. Macro stores them encrypted."
                  secondary={
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={flow.restart}
                    >
                      Back
                    </Button>
                  }
                  submit={{
                    label: flow.pending() ? 'Checking…' : 'Connect',
                    disabled: pasted().tokens.trim() === '',
                  }}
                  onSubmit={() => {
                    const result = parsed();
                    if (result.ok) run(flow.submitPasted(result.session));
                    else
                      flow.setFailure(
                        pastedSessionProblemMessage(result.problem)
                      );
                  }}
                >
                  <TextField value={pasted().tokens} onChange={set('tokens')}>
                    <TextField.Label>Tokens (one per line)</TextField.Label>
                    <TextField.TextArea
                      autoResize
                      placeholder="xoxc-…"
                      readOnly={flow.pending()}
                    />
                  </TextField>
                  <TextField value={pasted().cookie} onChange={set('cookie')}>
                    <TextField.Label>d cookie</TextField.Label>
                    <TextField.Input
                      type="password"
                      autocomplete="off"
                      placeholder="xoxd-…"
                      readOnly={flow.pending()}
                    />
                  </TextField>
                  <TextField
                    value={pasted().cookieDs}
                    onChange={set('cookieDs')}
                  >
                    <TextField.Label>d-s cookie (optional)</TextField.Label>
                    <TextField.Input
                      type="password"
                      autocomplete="off"
                      readOnly={flow.pending()}
                    />
                  </TextField>
                </StepForm>
              );
            })()}
          </Match>
          <Match when={flow.phase().kind === 'browser'}>
            <StepForm
              {...common()}
              title="Sign in to Slack"
              description="Slack's sign-in is open in a separate Macro window with its own cookies. Macro reads only the session once you're in."
            >
              <Working>Waiting for you to sign in…</Working>
            </StepForm>
          </Match>
          <Match when={flow.phase().kind === 'login'}>
            <Switch>
              {/* Keyed: each read of the attempt is a new step to show. */}
              <Match when={flow.step()} keyed>
                {(step) => loginStep(step)}
              </Match>
              <Match when={flow.login.isError}>
                <StepForm
                  {...common()}
                  title="Sign in to Slack"
                  description=""
                  secondary={
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={flow.restart}
                    >
                      Start again
                    </Button>
                  }
                >
                  <p role="alert" class="text-sm text-ink-muted">
                    Couldn't load this sign-in. It may have expired.
                  </p>
                </StepForm>
              </Match>
              <Match when={true}>
                <StepForm {...common()} title="Sign in to Slack" description="">
                  <Working>Loading…</Working>
                </StepForm>
              </Match>
            </Switch>
          </Match>
        </Switch>
      </ActionDialogShell>
    </Dialog>
  );
}
