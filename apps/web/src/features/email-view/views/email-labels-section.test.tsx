/**
 * @vitest-environment jsdom
 */

import { inboxLabelsOf } from '@queries/email/label-names';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLabelsSection } from './email-labels-section';

const LINKS = [
  { id: 'work', email_address: 'sam@acme.example', provider: 'GMAIL' },
  { id: 'home', email_address: 'sam@home.example', provider: 'GMAIL' },
];

const mocks = vi.hoisted(() => ({
  labels: [] as { id: string; linkId: string; name: string }[],
  inboxIds: undefined as string[] | undefined,
  openLabel: vi.fn(),
  setActive: (_ids: readonly string[]) => {},
}));

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/context/emailLinks', () => ({
  useEmailLinksContext: () => ({ links: () => LINKS }),
}));
vi.mock('@queries/email/label-names', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@queries/email/label-names')>();
  return {
    ...actual,
    useEmailInboxLabels: () => () => actual.inboxLabelsOf(mocks.labels, LINKS),
  };
});

vi.mock('../email-view-context', async () => {
  const { createSignal } = await import('solid-js');
  const [active, setActive] = createSignal<readonly string[]>([]);
  mocks.setActive = setActive;
  return {
    useEmailView: () => ({
      state: {
        get inboxIds() {
          return mocks.inboxIds;
        },
      },
      openLabel: (id: string) => {
        mocks.openLabel(id);
        setActive([id]);
      },
      activeLabelIds: active,
      isSidebarSectionOpen: () => true,
      setSidebarSectionOpen: () => {},
    }),
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.labels = [];
  mocks.inboxIds = undefined;
  mocks.openLabel.mockClear();
  mocks.setActive([]);
});

const made = (id: string, name: string, linkId = 'work') => ({
  id,
  linkId,
  name,
});

describe('EmailLabelsSection', () => {
  it('shows nothing while no inbox has labels people made', () => {
    render(() => <EmailLabelsSection />);
    expect(screen.queryByText('Labels')).toBeNull();
  });

  it('opens All mail filtered to a label, and nests a Gmail label under its parent', async () => {
    mocks.labels = [
      made('customers', 'Customers'),
      made('larkspur', 'Customers/Larkspur'),
    ];
    mocks.inboxIds = ['work'];
    render(() => <EmailLabelsSection />);

    // One picked inbox needs no account row.
    expect(screen.queryByText('sam@acme.example')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Customers' }));
    fireEvent.click(await screen.findByText('Larkspur'));
    expect(mocks.openLabel).toHaveBeenCalledWith('larkspur');
    expect(
      screen
        .getByText('Larkspur')
        .closest('button')
        ?.getAttribute('aria-current')
    ).toBe('page');
  });

  it('groups labels by inbox when all inboxes show, and only the picked one otherwise', () => {
    mocks.labels = [made('board', 'Board'), made('travel', 'Travel', 'home')];
    const { unmount } = render(() => <EmailLabelsSection />);
    expect(screen.getByText('sam@acme.example')).toBeTruthy();
    expect(screen.getByText('sam@home.example')).toBeTruthy();

    fireEvent.click(screen.getByText('sam@home.example'));
    expect(
      screen
        .getByText('sam@home.example')
        .closest('button')
        ?.getAttribute('aria-expanded')
    ).toBe('false');
    unmount();

    mocks.inboxIds = ['home'];
    render(() => <EmailLabelsSection />);
    expect(screen.queryByText('sam@home.example')).toBeNull();
    expect(screen.queryByText('Board')).toBeNull();
    expect(screen.getByText('Travel')).toBeTruthy();
  });

  it('names the inbox while all inboxes show, though only one has labels', () => {
    mocks.labels = [made('board', 'Board')];
    render(() => <EmailLabelsSection />);
    expect(screen.getByText('sam@acme.example')).toBeTruthy();
    expect(screen.getByText('Board')).toBeTruthy();
  });

  it('stops at eight labels, then lists the rest behind more', () => {
    mocks.labels = Array.from({ length: 11 }, (_, index) =>
      made(`label-${index}`, `Label ${String(index).padStart(2, '0')}`)
    );
    render(() => <EmailLabelsSection />);

    expect(screen.getByText('Label 07')).toBeTruthy();
    expect(screen.queryByText('Label 08')).toBeNull();
    fireEvent.click(screen.getByText('3 more'));
    expect(screen.getByText('Label 10')).toBeTruthy();
    fireEvent.click(screen.getByText('Show less'));
    expect(screen.queryByText('Label 10')).toBeNull();
  });
});

it('lists labels in the order of the inboxes given', () => {
  expect(
    inboxLabelsOf([made('b', 'B', 'home'), made('a', 'A')], LINKS).map(
      (label) => label.id
    )
  ).toEqual(['a', 'b']);
});
