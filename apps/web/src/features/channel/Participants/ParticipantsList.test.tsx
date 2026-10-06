/** @vitest-environment jsdom */

import type { ChannelParticipant } from '@queries/channel/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ParticipantsList } from './ParticipantsList';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => <span data-avatar={props.id} />,
}));
vi.mock('@core/user', () => ({
  getDisplayName: (id: string) => id,
  idToEmail: (id: string) => id,
  tryMacroId: (id: string) => id,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Badge')),
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Item')),
  ...(await import('@ui/components/Scroll')),
}));

// jsdom has no layout: provide measurements while using the real Scroll,
// Virtualizer, and participant rows, including their event handlers.
const observers = new Set<ResizeObserverStub>();
class ResizeObserverStub {
  targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    observers.delete(this);
  }
}

async function measure(viewport: Element) {
  // Resizing the viewport mounts rows; subsequent passes measure those rows.
  for (let pass = 0; pass < 3; pass++) {
    await Promise.resolve();
    for (const observer of observers) {
      observer.callback(
        Array.from(observer.targets, (target) => ({
          target,
          contentRect: new DOMRect(0, 0, 500, target === viewport ? 280 : 70),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        })),
        observer as unknown as ResizeObserver
      );
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('virtualizes a large unfiltered list in the Scroll viewport and supports filtering', async () => {
  const all: ChannelParticipant[] = Array.from(
    { length: 5000 },
    (_, index) => ({
      channel_id: 'channel',
      user_id: `person-${index}@example.com`,
      joined_at: '2026-10-05T00:00:00Z',
      role: 'member',
    })
  );
  const [participants, setParticipants] = createSignal(all);
  const [search, setSearch] = createSignal('');
  const onParticipantClick = vi.fn();
  const onRemoveParticipant = vi.fn();
  const { container } = render(() => (
    <ParticipantsList
      participants={participants}
      searchQuery={search}
      editable
      onParticipantClick={onParticipantClick}
      onRemoveParticipant={onRemoveParticipant}
    />
  ));
  const viewport = container.querySelector<HTMLDivElement>(
    '[aria-label="Participants list"] > div'
  )!;
  await measure(viewport);
  const mountedRows = () => screen.getAllByRole('link');
  expect(mountedRows().length).toBeGreaterThan(0);
  expect(mountedRows().length).toBeLessThan(40);
  expect(container.querySelectorAll('[data-avatar]').length).toBeLessThan(40);
  expect(
    screen.getByRole('link', { name: `Message ${all[0].user_id}` })
  ).toBeTruthy();

  viewport.scrollTop = 35004;
  fireEvent.scroll(viewport);
  await measure(viewport);
  expect(
    screen.queryByRole('link', { name: `Message ${all[0].user_id}` })
  ).toBeNull();
  expect(mountedRows().length).toBeLessThan(40);
  const target = mountedRows()[0];
  const targetId = target.getAttribute('aria-label')!.replace('Message ', '');
  fireEvent.click(target);
  expect(onParticipantClick).toHaveBeenCalledWith(
    targetId,
    expect.any(MouseEvent)
  );
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Remove participant' })[0]
  );
  expect(onRemoveParticipant).toHaveBeenCalledWith(targetId);
  expect(onParticipantClick).toHaveBeenCalledTimes(1);

  setSearch('person-4999');
  setParticipants([all[4999]]);
  await measure(viewport);
  expect(mountedRows()).toHaveLength(1);
  expect(
    screen.getByRole('link', { name: `Message ${all[4999].user_id}` })
  ).toBeTruthy();

  setSearch('no match');
  setParticipants([]);
  expect(screen.getByRole('status').textContent).toContain(
    'No participants match "no match".'
  );
  setSearch('');
  setParticipants(all);
  await measure(viewport);
  expect(mountedRows().length).toBeLessThan(40);
});
