/**
 * @vitest-environment jsdom
 */

import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type JSX, splitProps } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventAttendeeRow } from './EventAttendeeRow';
import {
  createEventDetailsOverlay,
  EventDetailsOverlayProvider,
} from './event-details-overlay';

const mocks = vi.hoisted(() => ({
  contact: { id: 'contact-1' } as { id: string } | null | undefined,
  contactQueryEnabled: undefined as boolean | undefined,
  crmEnabled: true,
  openWithSplit: vi.fn(),
  closeDetails: vi.fn(),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: () => null,
}));

vi.mock('./use-crm-enabled', () => ({
  useCrmEnabled: () => ({
    teamId: () => 'team-1',
    crmEnabled: () => mocks.crmEnabled,
  }),
}));

vi.mock('@queries/crm/contacts', () => ({
  useCrmContactByEmailQuery: (
    _teamId: () => string,
    _email: () => string,
    enabled: () => boolean
  ) => {
    mocks.contactQueryEnabled = enabled();
    return {
      get isSuccess() {
        return mocks.contact !== undefined;
      },
      get data() {
        return mocks.contact;
      },
    };
  },
}));

vi.mock('@core/component/UserTooltip', () => ({
  UserTooltip: (props: {
    displayName: string;
    email?: string;
    id?: string;
    onClose?: () => void;
  }) => (
    <div data-testid="person-menu" data-email={props.email} data-id={props.id}>
      {props.displayName}
      <button type="button" onClick={() => props.onClose?.()}>
        DM
      </button>
    </div>
  ),
}));

vi.mock('@ui', () => ({
  Button: (
    props: { label?: string; children: JSX.Element } & Record<string, unknown>
  ) => {
    const [local, rest] = splitProps(props, [
      'label',
      'children',
      'variant',
      'size',
      'depth',
    ]);
    return (
      <button type="button" aria-label={local.label} {...rest}>
        {local.children}
      </button>
    );
  },
  Layer: (props: { children: JSX.Element }) => props.children,
}));

const attendee: CalendarAttendee = {
  email: 'daniel@dojocoding.io',
  responseStatus: 'accepted',
  isSelf: false,
  isOrganizer: false,
  isOptional: false,
} as CalendarAttendee;

function renderRow(guest: CalendarAttendee = attendee) {
  const overlay = createEventDetailsOverlay(mocks.closeDetails);
  render(() => (
    <EventDetailsOverlayProvider value={overlay.context}>
      <EventAttendeeRow attendee={guest} displayName={() => 'Daniel'}>
        <span>Daniel</span>
      </EventAttendeeRow>
    </EventDetailsOverlayProvider>
  ));
  return overlay;
}

beforeEach(() => {
  mocks.contact = { id: 'contact-1' };
  mocks.contactQueryEnabled = undefined;
  mocks.crmEnabled = true;
  mocks.openWithSplit.mockReset();
  mocks.closeDetails.mockReset();
});

describe('EventAttendeeRow', () => {
  it('opens the contact record in a new split when the guest is a CRM contact', async () => {
    const user = userEvent.setup({ skipHover: true });
    renderRow();

    await user.click(screen.getByRole('button', { name: 'Daniel' }));

    expect(mocks.closeDetails).toHaveBeenCalledOnce();
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'contact', id: 'contact-1' },
      { preferNewSplit: true, activate: true }
    );
    expect(screen.queryByTestId('person-menu')).toBeNull();
  });

  it('opens the person menu instead when no contact record exists', async () => {
    mocks.contact = null;
    const user = userEvent.setup({ skipHover: true });
    const overlay = renderRow();

    await user.click(screen.getByRole('button', { name: 'Daniel' }));

    const menu = await screen.findByTestId('person-menu');
    expect(menu.dataset.email).toBe('daniel@dojocoding.io');
    expect(menu.dataset.id).toBe('macro|daniel@dojocoding.io');
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    // The details stay put underneath the menu until an action navigates.
    expect(overlay.hasNestedOverlay()).toBe(true);
    expect(mocks.closeDetails).not.toHaveBeenCalled();
  });

  it('reaches the person menu from the ... button even for a contact', async () => {
    const user = userEvent.setup({ skipHover: true });
    const overlay = renderRow();

    await user.click(
      screen.getByRole('button', { name: 'Actions for Daniel' })
    );
    await screen.findByTestId('person-menu');
    expect(overlay.hasNestedOverlay()).toBe(true);

    // A navigating menu action dismisses the menu and the details.
    await user.click(screen.getByRole('button', { name: 'DM' }));
    expect(mocks.closeDetails).toHaveBeenCalledOnce();
    expect(overlay.hasNestedOverlay()).toBe(false);
  });

  it('does not look the viewer up in the CRM', () => {
    renderRow({ ...attendee, isSelf: true });
    expect(mocks.contactQueryEnabled).toBe(false);
  });

  it('never opens a contact while CRM is off, even with stale data', async () => {
    mocks.crmEnabled = false;
    const user = userEvent.setup({ skipHover: true });
    renderRow();

    await user.click(screen.getByRole('button', { name: 'Daniel' }));

    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    await screen.findByTestId('person-menu');
  });
});
