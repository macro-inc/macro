import type { CombinedRecipientItem, WithCustomUserInput } from '@core/user';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecipientSelector } from './RecipientSelector';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'me@macro.com',
  useUserId: () => () => 'macro|me@macro.com',
}));
vi.mock('@core/user/dmActivity', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => <>{props.trigger}</>,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
// jsdom has no layout, so the virtualized list would render no options.
vi.mock('virtua/solid', async () => {
  const { For } = await import('solid-js');
  return {
    VList: (props: {
      data: unknown[];
      children: (item: unknown) => JSX.Element;
    }) => <For each={props.data}>{props.children}</For>,
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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Sending inboxes on domains other than the Macro login's.
const inboxes = [
  { provider: 'Gmail', address: 'me@northwind.example' },
  { provider: 'Outlook', address: 'me@contoso.example' },
] as const;

const recent = new Date(Date.now() - 60 * 60 * 1000);

const contact = (email: string, name: string): CombinedRecipientItem => ({
  kind: 'contact',
  id: `macro|${email}`,
  data: { id: `macro|${email}`, email, name, type: 'extracted' },
});

const user = (
  email: string,
  name: string,
  lastInteraction?: Date
): CombinedRecipientItem => ({
  kind: 'user',
  id: `macro|${email}`,
  data: { id: `macro|${email}`, email, name, lastInteraction },
});

function renderSelector(options: CombinedRecipientItem[], selfEmail: string) {
  const [selected, setSelected] = createSignal<WithCustomUserInput[]>([]);
  render(() => (
    <RecipientSelector
      options={() => options}
      selfEmail={selfEmail}
      selectedOptions={selected()}
      setSelectedOptions={setSelected}
      openOnFocus={false}
    />
  ));
  const input = screen.getByRole<HTMLInputElement>('combobox');
  return {
    input,
    selectedEmails: () =>
      selected().flatMap((option) =>
        'email' in option.data ? [option.data.email] : []
      ),
    async suggestions() {
      await screen.findByRole('listbox');
      return screen.getAllByRole('option').map((o) => o.textContent ?? '');
    },
  };
}

it.each(inboxes)(
  'commits the exact known address typed in a $provider inbox on Enter',
  async ({ address }) => {
    const selector = renderSelector(
      [
        user('teo+123456@macro.com', 'Teo QA', recent),
        contact('teo@macro.com', 'Teo Snyder'),
      ],
      address
    );
    fireEvent.input(selector.input, { target: { value: 'teo@macro.com' } });
    await selector.suggestions();
    fireEvent.keyDown(selector.input, { key: 'Enter' });

    await waitFor(() =>
      expect(selector.selectedEmails()).toEqual(['teo@macro.com'])
    );
  }
);

it.each(inboxes)(
  'commits a typed address no one is saved under in a $provider inbox on Enter',
  async ({ address }) => {
    const selector = renderSelector(
      [user('teo+123456@macro.com', 'Teo QA', recent)],
      address
    );
    fireEvent.input(selector.input, { target: { value: 'teo@macro.com' } });
    await selector.suggestions();
    fireEvent.keyDown(selector.input, { key: 'Enter' });

    await waitFor(() =>
      expect(selector.selectedEmails()).toEqual(['teo@macro.com'])
    );
  }
);

it.each(inboxes)(
  'suggests a contact whose name starts with the query near the top in a $provider inbox',
  async ({ address }) => {
    const selector = renderSelector(
      [
        user('eric.ngabo@macro.com', 'Eric Ngabo', recent),
        user('ligaba.t@macro.com', 'Ligaba Tesfaye', recent),
        user('gabriel@macro.com', 'Gabriel Ortiz', recent),
        contact('tickets@omegabus.example', 'Omegabus Lines'),
        contact('orders@vagabond.example', 'Vagabond Cafe'),
        contact('gab@contoso.example', 'Gab Rowan'),
      ],
      address
    );
    fireEvent.input(selector.input, { target: { value: 'gab' } });

    const position = (await selector.suggestions()).findIndex((text) =>
      text.includes('gab@contoso.example')
    );
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(3);
  }
);

it.each(inboxes)(
  'lists colleagues on the $provider sending domain first',
  async ({ address }) => {
    const domain = address.split('@')[1];
    const selector = renderSelector(
      [
        user('sam@macro.com', 'Sam Lee'),
        contact(`riley@${domain}`, 'Riley Park'),
      ],
      address
    );
    fireEvent.keyDown(selector.input, { key: 'ArrowDown' });

    const [first] = await selector.suggestions();
    expect(first).toContain(`riley@${domain}`);
  }
);

const automated = [
  contact('notifications@codehost.example', 'Code Host'),
  contact('mailer-daemon@mail.example', 'Mail Delivery Subsystem'),
  contact('postmaster@mail.example', 'Postmaster'),
  contact('bounce+82731@lists.example', 'List Bounces'),
  contact('noreply@vendor.example', 'Vendor Billing'),
  contact('do-not-reply@shop.example', 'Shop Orders'),
];

it.each(inboxes)(
  'leaves automated addresses out of $provider suggestions',
  async ({ address }) => {
    const selector = renderSelector(
      [...automated, contact('notifier.jones@vendor.example', 'Nora Jones')],
      address
    );
    fireEvent.input(selector.input, { target: { value: 'example' } });

    const suggestions = await selector.suggestions();
    expect(suggestions.join(' ')).toContain('Nora Jones');
    for (const { data } of automated)
      expect(suggestions.join(' ')).not.toContain(
        'email' in data ? data.email : ''
      );
  }
);

it.each(inboxes)(
  'adds an automated address typed in full in a $provider inbox',
  async ({ address }) => {
    const selector = renderSelector(automated, address);
    fireEvent.input(selector.input, {
      target: { value: 'noreply@vendor.example' },
    });
    await selector.suggestions();
    fireEvent.keyDown(selector.input, { key: 'Enter' });

    await waitFor(() =>
      expect(selector.selectedEmails()).toEqual(['noreply@vendor.example'])
    );
  }
);
