import { SERVER_HOSTS } from '@core/constant/servers';
import { useEmail, useIsAuthenticated } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CopyIcon from '@phosphor/copy.svg';
import {
  type StatusUpdate,
  useCurrentSystemStatusQuery,
  useSetSystemStatusMutation,
  useSystemStatusHistoryQuery,
} from '@queries/system-status/status';
import {
  Button,
  ConfirmDialog,
  CopyButton,
  SegmentedControl,
  TextField,
} from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { StatusBanner } from '../components/StatusBanner';
import {
  bannerStatus,
  MAX_MESSAGE_LENGTH,
  STATUS_LABELS,
  STATUS_LEVELS,
  type StatusLevel,
} from '../core/status';

const STAFF_EMAIL_DOMAIN = '@macro.com';

/**
 * Internal dashboard for setting the status banner every user sees. Reachable
 * at `/internal/status`; the auth service only accepts staff, this gate just
 * keeps everyone else from seeing an empty shell.
 */
export function SystemStatusDashboard() {
  const isAuthenticated = useIsAuthenticated();
  const email = useEmail();
  const isStaff = () =>
    email()?.toLowerCase().endsWith(STAFF_EMAIL_DOMAIN) ?? false;

  return (
    <div class="size-full overflow-y-auto bg-surface font-sans text-ink">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)] sm:px-6">
        <header class="flex flex-col gap-1">
          <h1 class="text-xl font-semibold tracking-tight">System status</h1>
          <p class="text-sm text-ink-muted">
            While Macro isn't operational, every user sees a banner with the
            status and your message. Changes reach open apps immediately.
          </p>
        </header>

        <Switch>
          <Match when={isAuthenticated() === false}>
            <Gate body="Log in with a @macro.com account to continue." />
          </Match>
          <Match when={isAuthenticated() === true && !isStaff()}>
            <Gate body="Only @macro.com accounts can set the system status." />
          </Match>
          <Match when={isAuthenticated() === true && isStaff()}>
            <CurrentStatus />
            <SetStatusForm />
            <History />
            <ApiDocs />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function Gate(props: { body: string }) {
  return (
    <div class="flex flex-col gap-1 rounded-xl border border-edge p-6">
      <h2 class="text-base font-semibold">Macro staff only</h2>
      <p class="text-sm text-ink-muted">{props.body}</p>
    </div>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function CurrentStatus() {
  const query = useCurrentSystemStatusQuery();
  const banner = () =>
    !query.isPending && query.data ? bannerStatus(query.data) : undefined;

  return (
    <Section title="Current status">
      <Switch>
        <Match when={query.isPending}>
          <p class="text-sm text-ink-muted">Loading…</p>
        </Match>
        <Match when={query.isError && !query.data}>
          <p class="text-sm text-failure">
            Couldn't load the current status — refresh to try again.
          </p>
        </Match>
        <Match when={banner()}>
          {(status) => (
            <StatusBanner
              {...status()}
              class="rounded-lg border touch:pt-1.5"
            />
          )}
        </Match>
        <Match when={query.data}>
          <p class="rounded-lg border border-success/20 bg-success-bg px-4 py-2 text-sm text-success-ink">
            Operational — no banner is showing.
          </p>
        </Match>
      </Switch>
    </Section>
  );
}

function SetStatusForm() {
  const [level, setLevel] = createSignal<StatusLevel>('degraded');
  const [message, setMessage] = createSignal('');
  const [confirming, setConfirming] = createSignal(false);
  const setStatus = useSetSystemStatusMutation();

  const trimmed = () => message().trim();
  const needsMessage = () => level() !== 'operational';
  const canSubmit = () =>
    !setStatus.isPending &&
    (!needsMessage() ||
      (trimmed().length > 0 && trimmed().length <= MAX_MESSAGE_LENGTH));

  const publish = () => {
    const status = match(level())
      .with('operational', () => ({ status: 'operational' as const }))
      .with('degraded', 'major_outage', (status) => ({
        status,
        message: trimmed(),
      }))
      .exhaustive();
    setStatus.mutate(status, {
      onSuccess: () => setMessage(''),
    });
  };

  return (
    <Section title="Set status">
      <form
        class="flex flex-col gap-4 rounded-xl border border-edge p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit()) setConfirming(true);
        }}
      >
        <SegmentedControl
          aria-label="Status"
          value={level()}
          onChange={setLevel}
          options={STATUS_LEVELS.map((value) => ({
            value,
            label: STATUS_LABELS[value],
          }))}
        />
        <Show when={needsMessage()}>
          <TextField value={message()} onChange={setMessage} required>
            <TextField.Label>Message</TextField.Label>
            <TextField.TextArea
              autoResize
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Search results are delayed. We're working on a fix."
            />
            <TextField.Description>
              {trimmed().length}/{MAX_MESSAGE_LENGTH} · shown to every user
            </TextField.Description>
          </TextField>
          <Show when={trimmed()}>
            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-ink-muted">Preview</span>
              <StatusBanner
                level={level() === 'major_outage' ? 'major_outage' : 'degraded'}
                message={trimmed()}
                class="rounded-lg border touch:pt-1.5"
              />
            </div>
          </Show>
        </Show>
        <div class="flex justify-end">
          <Button variant="cta" size="lg" type="submit" disabled={!canSubmit()}>
            {setStatus.isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming()}
        onOpenChange={setConfirming}
        title={`Set status to ${STATUS_LABELS[level()]}?`}
        body={
          needsMessage()
            ? 'Every user will see this banner right away.'
            : 'The banner will disappear for every user.'
        }
        confirmLabel="Publish"
        tone={level() === 'major_outage' ? 'danger' : 'default'}
        onConfirm={publish}
      />
    </Section>
  );
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function History() {
  const query = useSystemStatusHistoryQuery();
  const updates = (): StatusUpdate[] =>
    !query.isPending && query.data ? query.data : [];

  return (
    <Section title="History">
      <Switch>
        <Match when={query.isPending}>
          <p class="text-sm text-ink-muted">Loading…</p>
        </Match>
        <Match when={query.isError && !query.data}>
          <p class="text-sm text-failure">
            Couldn't load the history — refresh to try again.
          </p>
        </Match>
        <Match when={updates().length === 0}>
          <p class="rounded-xl border border-dashed border-edge px-4 py-6 text-center text-sm text-ink-muted">
            No status has been set yet.
          </p>
        </Match>
        <Match when={updates().length > 0}>
          <ul class="flex flex-col divide-y divide-edge-muted rounded-xl border border-edge">
            <For each={updates()}>
              {(update) => (
                <li class="flex flex-col gap-1 px-4 py-3 text-sm">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span class="font-medium">
                      {STATUS_LABELS[update.status]}
                    </span>
                    <span class="text-xs text-ink-muted">
                      {dateTime.format(new Date(update.createdAt))} ·{' '}
                      {idToDisplayName(update.userId)}
                    </span>
                  </div>
                  <Show when={'message' in update ? update.message : undefined}>
                    {(text) => <p class="text-ink-muted">{text()}</p>}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </Section>
  );
}

function ApiDocs() {
  const endpoint = `${SERVER_HOSTS['auth-service']}/system-status`;
  const example = () =>
    [
      `curl -X POST ${endpoint} \\`,
      `  -H 'x-macro-user-api-key: <your API key>' \\`,
      `  -H 'content-type: application/json' \\`,
      `  -d '{"status": "degraded", "message": "Search is slow to update."}'`,
    ].join('\n');

  return (
    <Section title="API">
      <div class="flex flex-col gap-3 text-sm text-ink-muted">
        <p>
          Any @macro.com account can set the status from a script with a
          personal API key (Settings → API keys). <code>status</code> is{' '}
          <code>operational</code>, <code>degraded</code>, or{' '}
          <code>major_outage</code>; the latter two require a 1–
          {MAX_MESSAGE_LENGTH} character <code>message</code>, and operational
          takes none. <code>GET {endpoint}</code> returns the current status (no
          auth), and <code>GET {endpoint}/history</code> the recent updates.
        </p>
        <div class="relative">
          <pre class="overflow-x-auto rounded-lg border border-edge bg-ink/[0.03] p-3 pr-12 text-xs text-ink">
            {example()}
          </pre>
          <CopyButton
            variant="ghost"
            size="sm"
            class="absolute top-2 right-2"
            aria-label="Copy example"
            onClick={() => navigator.clipboard.writeText(example())}
          >
            <CopyIcon class="size-4" />
          </CopyButton>
        </div>
      </div>
    </Section>
  );
}
