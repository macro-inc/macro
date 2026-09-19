import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useEmail, useIsAuthenticated } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import LogoIcon from '@icon/macro-logo.svg';
import CopyIcon from '@phosphor/copy.svg';
import LinkIcon from '@phosphor/link.svg';
import XIcon from '@phosphor/x.svg';
import {
  type GtmInviteLink,
  useCreateGtmInviteLinkMutation,
  useGtmInviteLinksQuery,
  useRevokeGtmInviteLinkMutation,
} from '@queries/gtm-invite/links';
import { useNavigate } from '@solidjs/router';
import { Button, cn } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  buildInviteLinkUrl,
  describeInviteStatus,
  formatFreeMonths,
  formatTimeLeft,
  INVITE_PORTAL_ROUTE,
  type InviteStatusTone,
} from './core/invite-link';

const STAFF_EMAIL_DOMAIN = '@macro.com';

/**
 * Internal portal for the GTM team: mint personal 48-hour invite links and
 * watch them get opened, signed up through, and converted. Reachable at
 * `/internal/invite-links`; the auth service only serves staff accounts, this
 * gate just keeps everyone else from seeing an empty shell.
 */
export function InviteLinksPortal() {
  const isAuthenticated = useIsAuthenticated();
  const email = useEmail();
  const navigate = useNavigate();
  const analytics = useAnalytics();

  const isStaff = () =>
    email()?.toLowerCase().endsWith(STAFF_EMAIL_DOMAIN) ?? false;

  onMount(() => {
    analytics.pageView('gtm_invite_portal');
  });

  return (
    <div class="size-full overflow-y-auto bg-surface font-sans text-ink">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header class="flex items-center gap-3">
          <LogoIcon class="size-8 text-accent" />
          <div class="flex flex-col">
            <h1 class="text-xl font-semibold tracking-tight">Invite links</h1>
            <p class="text-sm text-ink-muted">
              Personal signup links for prospects. Each one is good for 48 hours
              and gives the recipient their first month of Premium free.
            </p>
          </div>
        </header>

        <Switch>
          <Match when={isAuthenticated() === false}>
            <Gate
              title="Log in to continue"
              body="This page is for Macro staff."
              action={
                <Button
                  variant="cta"
                  size="lg"
                  onClick={() =>
                    navigate(
                      `/login?redirect=${encodeURIComponent(INVITE_PORTAL_ROUTE)}`
                    )
                  }
                >
                  Log in
                </Button>
              }
            />
          </Match>
          <Match when={isAuthenticated() === true && !isStaff()}>
            <Gate
              title="Macro staff only"
              body="Invite links can only be created from a @macro.com account."
            />
          </Match>
          <Match when={isAuthenticated() === true && isStaff()}>
            <PortalBody />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function Gate(props: { title: string; body: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-col items-start gap-4 rounded-xl border border-edge p-6">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-semibold">{props.title}</h2>
        <p class="text-sm text-ink-muted">{props.body}</p>
      </div>
      {props.action}
    </div>
  );
}

function PortalBody() {
  const [mine, setMine] = createSignal(false);
  const [latest, setLatest] = createSignal<GtmInviteLink | undefined>();
  const linksQuery = useGtmInviteLinksQuery(mine);
  const links = () => (linksQuery.isSuccess ? linksQuery.data : []);

  return (
    <div class="flex flex-col gap-8">
      <CreateLinkForm onCreated={setLatest} />

      <Show when={latest()}>{(link) => <LatestLinkCard link={link()} />}</Show>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">Links</h2>
          <div class="flex gap-1 rounded-lg border border-edge p-0.5">
            <FilterButton active={!mine()} onClick={() => setMine(false)}>
              Everyone's
            </FilterButton>
            <FilterButton active={mine()} onClick={() => setMine(true)}>
              Mine
            </FilterButton>
          </div>
        </div>
        <Switch>
          <Match when={linksQuery.isPending}>
            <p class="py-6 text-sm text-ink-muted">Loading…</p>
          </Match>
          <Match when={linksQuery.isError}>
            <p class="py-6 text-sm text-failure">
              Couldn't load invite links — refresh to try again.
            </p>
          </Match>
          <Match when={links().length === 0}>
            <p class="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm text-ink-muted">
              No links yet. Create one above and send it along.
            </p>
          </Match>
          <Match when={links().length > 0}>
            <LinksTable links={links()} />
          </Match>
        </Switch>
      </section>
    </div>
  );
}

function FilterButton(props: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cn(
        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
        props.active
          ? 'bg-ink text-surface'
          : 'text-ink-muted hover:bg-hover hover:text-ink'
      )}
    >
      {props.children}
    </button>
  );
}

function Field(props: {
  id: string;
  label: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  value: string;
  required?: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <label class="flex flex-col gap-1.5" for={props.id}>
      <span class="text-xs font-medium text-ink-muted">
        {props.label}
        <Show when={!props.required}>
          <span class="font-normal"> (optional)</span>
        </Show>
      </span>
      <input
        id={props.id}
        name={props.id}
        type={props.type ?? 'text'}
        placeholder={props.placeholder}
        value={props.value}
        required={props.required}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        class="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-placeholder transition-colors focus:border-accent focus:outline-none"
      />
      <Show when={props.hint}>
        <span class="text-xs text-ink-muted">{props.hint}</span>
      </Show>
    </label>
  );
}

function CreateLinkForm(props: { onCreated: (link: GtmInviteLink) => void }) {
  const analytics = useAnalytics();
  const [firstName, setFirstName] = createSignal('');
  const [recipientEmail, setRecipientEmail] = createSignal('');
  const [note, setNote] = createSignal('');

  const create = useCreateGtmInviteLinkMutation({
    onSuccess: (link) => {
      props.onCreated(link);
      analytics.track('gtm_invite_link_created', { link_id: link.id });
      setFirstName('');
      setRecipientEmail('');
      setNote('');
      void copyLink(link, { silent: true });
      toast.success(`Link for ${link.firstName} created and copied`);
    },
  });

  const canSubmit = () => firstName().trim().length > 0 && !create.isPending;

  return (
    <form
      class="flex flex-col gap-4 rounded-xl border border-edge p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit()) return;
        create.mutate({
          firstName: firstName().trim(),
          recipientEmail: recipientEmail().trim() || null,
          note: note().trim() || null,
        });
      }}
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-semibold">New invite link</h2>
        <p class="text-sm text-ink-muted">
          The recipient sees "Welcome, {firstName().trim() || 'their name'}" and
          a Continue button that takes them into signup.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <Field
          id="firstName"
          label="First name"
          placeholder="Ada"
          value={firstName()}
          required
          onInput={setFirstName}
        />
        <Field
          id="recipientEmail"
          label="Email"
          type="email"
          placeholder="ada@company.com"
          hint="For your own tracking; the link isn't tied to it."
          value={recipientEmail()}
          onInput={setRecipientEmail}
        />
        <Field
          id="note"
          label="Note"
          placeholder="Met at the Series A dinner"
          value={note()}
          onInput={setNote}
        />
      </div>
      <div class="flex items-center justify-end gap-3">
        <Button variant="cta" size="lg" type="submit" disabled={!canSubmit()}>
          <LinkIcon class="size-4" />
          {create.isPending ? 'Creating…' : 'Create link'}
        </Button>
      </div>
    </form>
  );
}

async function copyLink(link: GtmInviteLink, options?: { silent?: boolean }) {
  const url = buildInviteLinkUrl(link.token);
  try {
    await navigator.clipboard.writeText(url);
    if (!options?.silent) toast.success('Link copied');
  } catch {
    toast.failure("Couldn't copy — select the link and copy it manually");
  }
}

function LatestLinkCard(props: { link: GtmInviteLink }) {
  const url = () => buildInviteLinkUrl(props.link.token);
  return (
    <div class="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-5">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-semibold">
          Link for {props.link.firstName} ·{' '}
          {formatFreeMonths(props.link.freeMonths)} · expires in{' '}
          {formatTimeLeft(props.link.expiresAt).replace(' left', '')}
        </span>
        <Button variant="strong" size="sm" onClick={() => copyLink(props.link)}>
          <CopyIcon class="size-4" />
          Copy link
        </Button>
      </div>
      <code class="break-all rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-ink select-all">
        {url()}
      </code>
    </div>
  );
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDate(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

function StatusPill(props: { status: GtmInviteLink['status'] }) {
  const presentation = createMemo(() => describeInviteStatus(props.status));
  const toneClass = (tone: InviteStatusTone) =>
    ({
      accent: 'bg-accent/15 text-accent',
      muted: 'bg-ink/10 text-ink-muted',
      success: 'bg-success-bg text-success',
      failure: 'bg-failure-bg text-failure',
    })[tone];
  return (
    <span
      class={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        toneClass(presentation().tone)
      )}
    >
      {presentation().label}
    </span>
  );
}

function LinksTable(props: { links: GtmInviteLink[] }) {
  const revoke = useRevokeGtmInviteLinkMutation();

  return (
    <div class="overflow-x-auto rounded-xl border border-edge">
      <table class="w-full min-w-200 text-left text-sm">
        <thead class="bg-ink/[0.03] text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th class="px-4 py-2.5 font-medium">Recipient</th>
            <th class="px-4 py-2.5 font-medium">Status</th>
            <th class="px-4 py-2.5 font-medium">Sent by</th>
            <th class="px-4 py-2.5 font-medium">Created</th>
            <th class="px-4 py-2.5 font-medium">Opens</th>
            <th class="px-4 py-2.5 font-medium">Signed up</th>
            <th class="px-4 py-2.5 font-medium">Subscribed</th>
            <th class="px-4 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody>
          <For each={props.links}>
            {(link) => (
              <tr class="border-t border-edge-muted align-top">
                <td class="px-4 py-3">
                  <div class="flex flex-col">
                    <span class="font-medium text-ink">{link.firstName}</span>
                    <Show when={link.recipientEmail}>
                      <span class="text-xs text-ink-muted">
                        {link.recipientEmail}
                      </span>
                    </Show>
                    <Show when={link.note}>
                      <span class="text-xs text-ink-muted italic">
                        {link.note}
                      </span>
                    </Show>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-col gap-1">
                    <StatusPill status={link.status} />
                    <Show when={link.status === 'active'}>
                      <span class="text-xs text-ink-muted">
                        {formatTimeLeft(link.expiresAt)}
                      </span>
                    </Show>
                  </div>
                </td>
                <td class="px-4 py-3 text-ink">
                  {idToDisplayName(link.createdBy)}
                </td>
                <td class="px-4 py-3 text-ink-muted">
                  {formatDate(link.createdAt)}
                </td>
                <td class="px-4 py-3 text-ink-muted">
                  <div class="flex flex-col">
                    <span class="text-ink">{link.openCount}</span>
                    <Show when={link.firstOpenedAt}>
                      <span class="text-xs">
                        first {formatDate(link.firstOpenedAt)}
                      </span>
                    </Show>
                  </div>
                </td>
                <td class="px-4 py-3 text-ink-muted">
                  <Show when={link.redeemedBy} fallback="—">
                    {(redeemedBy) => (
                      <div class="flex flex-col">
                        <span class="text-ink">
                          {idToDisplayName(redeemedBy())}
                        </span>
                        <span class="text-xs">
                          {formatDate(link.redeemedAt)}
                        </span>
                      </div>
                    )}
                  </Show>
                </td>
                <td class="px-4 py-3 text-ink-muted">
                  <Show when={link.convertedAt} fallback="—">
                    {(convertedAt) => (
                      <div class="flex flex-col">
                        <span class="text-ink">
                          {formatDate(convertedAt())}
                        </span>
                        <Show when={link.stripeSubscriptionId}>
                          <span class="text-xs">
                            {link.stripeSubscriptionId}
                          </span>
                        </Show>
                      </div>
                    )}
                  </Show>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLink(link)}
                      title="Copy link"
                    >
                      <CopyIcon class="size-4" />
                    </Button>
                    <Show when={link.status === 'active'}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ id: link.id })}
                        title="Revoke link"
                      >
                        <XIcon class="size-4" />
                      </Button>
                    </Show>
                  </div>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
