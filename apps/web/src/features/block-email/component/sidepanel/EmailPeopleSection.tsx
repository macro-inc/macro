import { createCrmPerson } from '@app/features/crm/crm-person';
import { EmailUserTooltip } from '@app/features/email-message/components/email-user-tooltip';
import { isViewerAddress } from '@app/features/email-message/core/email-user';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { useEmailThreadViewContext } from '@app/features/email-thread/context/email-thread-view-context';
import {
  collectEmailParticipants,
  type EmailParticipant,
  type EmailParticipantRole,
} from '@app/features/email-thread/core/participants';
import { formatLocale, t } from '@app/lib/i18n';
import { usePreference } from '@app/preferences/use-preference';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { emailToMacroId } from '@core/user/macroId';
import ContactIcon from '@icon/system/regular/address-book.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import LinkIcon from '@icon/system/regular/link-simple.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, badgeTriggerClasses } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  Show,
} from 'solid-js';

const SECTION_ID = 'people';
const DEFAULT_VISIBLE_COUNT = 6;
const LINK_CLASS = badgeTriggerClasses({
  variant: 'outline',
  size: 'sm',
  class: 'gap-1.5 bg-surface-2 border-edge min-w-0 max-w-full',
});

/**
 * The sender and recipients of the open thread, other than the viewer, with
 * their CRM contact and company when the team tracks them.
 */
export function EmailPeopleSection(props: { order: number }) {
  const state = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();
  const people = createMemo(() =>
    collectEmailParticipants(state.messages.list()).filter(
      (person) =>
        !isViewerAddress(person.email, viewContext.thread.viewerEmail())
    )
  );
  const [open, setOpen] = usePreference(
    'macro:pref:email:side-panel-people-open',
    { default: true }
  );
  persistSectionOpenState(setOpen);

  return (
    <Show when={people().length > 0}>
      <SidePanel.Section
        id={SECTION_ID}
        title={
          <SidePanel.CountTitle
            label={t('emailPeople.title')}
            count={people().length}
          />
        }
        defaultOpen={open()}
        order={props.order}
      >
        <PeopleList people={people()} />
      </SidePanel.Section>
    </Show>
  );
}

/** Records the user's expand/collapse choice while the section is registered. */
function persistSectionOpenState(setOpen: (open: boolean) => void) {
  const panel = useSidePanel();
  if (!panel) return;
  createEffect(
    on(
      () => panel.openSectionIds().includes(SECTION_ID),
      (isOpen) => {
        // Unregistering also drops the id; that is not a user choice.
        if (!panel.sections().some((section) => section.id === SECTION_ID))
          return;
        setOpen(isOpen);
      },
      { defer: true }
    )
  );
}

function PeopleList(props: { people: EmailParticipant[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const hiddenCount = () =>
    Math.max(0, props.people.length - DEFAULT_VISIBLE_COUNT);
  const visible = () =>
    expanded() ? props.people : props.people.slice(0, DEFAULT_VISIBLE_COUNT);

  return (
    <div class="flex flex-col gap-1">
      <ul class="flex flex-col divide-y divide-edge-muted">
        <Key each={visible()} by="email">
          {(person) => <PersonRow person={person()} />}
        </Key>
      </ul>
      <Show when={hiddenCount() > 0}>
        <Button
          variant="ghost"
          size="sm"
          class="self-start text-ink-muted"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded()
            ? t('emailPeople.showLess')
            : t('emailPeople.showMore', { count: hiddenCount() })}
        </Button>
      </Show>
    </div>
  );
}

function roleLabel(role: EmailParticipantRole) {
  switch (role) {
    case 'from':
      return t('emailPeople.roleFrom');
    case 'to':
      return t('emailPeople.roleTo');
    case 'cc':
      return t('emailPeople.roleCc');
  }
}

function linkedInSearchUrl(keywords: string) {
  const url = new URL('https://www.linkedin.com/search/results/people/');
  url.searchParams.set('keywords', keywords);
  return url.toString();
}

function PersonRow(props: { person: EmailParticipant }) {
  const { openWithSplit } = useSplitLayout();
  const crm = createCrmPerson(() => props.person.email);
  const name = () => crm.contact()?.name ?? props.person.name;
  const domain = () => crm.company()?.domains[0]?.domain;
  const iconProps = (): UserIconProps => {
    const macroId = emailToMacroId(props.person.email);
    if (macroId) return { id: macroId, photoUrl: props.person.photoUrl };
    return { email: props.person.email, photoUrl: props.person.photoUrl };
  };
  const lastContacted = () => {
    const timestamp = crm.contact()?.lastInteraction;
    if (!timestamp) return undefined;
    return new Intl.DateTimeFormat(formatLocale(), {
      dateStyle: 'medium',
    }).format(new Date(timestamp));
  };
  const open = (
    event: MouseEvent,
    target: { type: 'contact' | 'company'; id: string }
  ) =>
    openWithSplit(target, {
      preferNewSplit: event.shiftKey,
      reopen: 'latest',
    });

  return (
    <li class="flex min-w-0 gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <UserIcon
        {...iconProps()}
        isDeleted={false}
        size="lg"
        suppressClick
        showTooltip={false}
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 flex-col">
          <div class="flex min-w-0 items-baseline gap-1.5">
            <EmailUserTooltip
              recipient={{ email: props.person.email, name: name() }}
              photoUrl={props.person.photoUrl}
              triggerClass="min-w-0 truncate"
            >
              <span class="truncate font-medium text-ink">
                {name() ?? props.person.email}
              </span>
            </EmailUserTooltip>
            <span class="shrink-0 text-xs text-ink-extra-muted">
              {roleLabel(props.person.role)}
            </span>
          </div>
          <Show when={name()}>
            <span class="truncate text-xs text-ink-muted">
              {props.person.email}
            </span>
          </Show>
          <Show when={lastContacted()}>
            {(date) => (
              <span class="truncate text-xs text-ink-extra-muted">
                {t('emailPeople.lastContacted', { date: date() })}
              </span>
            )}
          </Show>
        </div>
        <div class="flex min-w-0 flex-wrap gap-1">
          <Show when={crm.company()}>
            {(company) => (
              <LinkButton
                label={t('emailPeople.openCompanyLabel', {
                  name: company().name,
                })}
                onClick={(event) =>
                  open(event, { type: 'company', id: company().id })
                }
              >
                <EntityIcon targetType="crm_company" size="xs" />
                <span class="truncate">{company().name}</span>
              </LinkButton>
            )}
          </Show>
          <Show when={crm.contact()}>
            {(contact) => (
              <LinkButton
                label={t('emailPeople.openContactLabel')}
                onClick={(event) =>
                  open(event, { type: 'contact', id: contact().id })
                }
              >
                <ContactIcon class="size-3 shrink-0" />
                {t('emailPeople.openContact')}
              </LinkButton>
            )}
          </Show>
          <Show when={domain()}>
            {(domain) => (
              <a
                href={`https://${domain()}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('emailPeople.websiteLabel', {
                  domain: domain(),
                })}
                class={LINK_CLASS}
              >
                <GlobeIcon class="size-3 shrink-0" />
                {t('emailPeople.website')}
              </a>
            )}
          </Show>
          <Show when={name()}>
            {(name) => (
              <a
                href={linkedInSearchUrl(
                  [name(), crm.company()?.name].filter(Boolean).join(' ')
                )}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('emailPeople.linkedInLabel', { name: name() })}
                class={LINK_CLASS}
              >
                <LinkIcon class="size-3 shrink-0" />
                {t('emailPeople.linkedIn')}
              </a>
            )}
          </Show>
        </div>
      </div>
    </li>
  );
}

function LinkButton(
  props: ParentProps<{ label: string; onClick: (event: MouseEvent) => void }>
) {
  return (
    <button
      type="button"
      aria-label={props.label}
      class={LINK_CLASS}
      onClick={(event) => props.onClick(event)}
    >
      {props.children}
    </button>
  );
}
