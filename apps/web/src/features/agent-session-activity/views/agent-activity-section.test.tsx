import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type Setter, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentActivityRow,
  AgentActivitySourceProvider,
} from '../context/agent-activity-source';
import { AgentActivitySection } from './agent-activity-section';

vi.mock('@components/app/side-panel', () => ({
  useSidePanel: () => null,
  SidePanel: {
    Section: (props: { title: JSX.Element; children: JSX.Element }) => (
      <section>
        <h2>{props.title}</h2>
        {props.children}
      </section>
    ),
    CountTitle: (props: { label: JSX.Element; count: number }) => (
      <>
        {props.label} ({props.count})
      </>
    ),
  },
}));

vi.mock('@property/hooks', () => ({
  usePropertyEntityDisplay: () => ({
    name: () => 'Example document',
    icon: () => null,
    isLoading: () => false,
    hasPreviewAccess: () => true,
    blockOrFileType: () => 'md',
    linkParams: () => undefined,
  }),
}));

vi.mock('@app/features/activity/components/entity-mention', () => ({
  EntityMention: (props: {
    display: { name: () => string; blockOrFileType: () => string | null };
  }) => (
    <Show
      when={props.display.blockOrFileType()}
      fallback={<span>{props.display.name()}</span>}
    >
      <a href="#entity">{props.display.name()}</a>
    </Show>
  ),
}));

vi.mock('@app/features/activity/context/activity-context', () => ({
  useActivityContext: () => ({ entityDisplay: () => undefined }),
}));

vi.mock('@ui', async (importOriginal) => ({
  cn: (await importOriginal<typeof import('@ui')>()).cn,
  Button: (props: {
    children: JSX.Element;
    onClick: () => void;
    'aria-label'?: string;
  }) => (
    <button aria-label={props['aria-label']} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('@core/util/useCopyLink', () => ({
  useCopyLink: () => async () => true,
}));

vi.mock('@app/features/activity/open-entity-in-split', () => ({
  openEntityInSplit: vi.fn(),
}));

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => null,
  getIconConfig: () => ({ icon: () => null }),
}));

// The shared collapse animation measures with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

afterEach(cleanup);

const row = (id: string, entityId: string, verb: string): AgentActivityRow => ({
  id,
  entityType: 'document',
  entityId,
  action: verb,
  verb,
  occurredAt: '2026-01-01T00:00:00Z',
});

function setup(initial: AgentActivityRow[]) {
  let setRows: Setter<AgentActivityRow[]>;
  render(() => {
    const [rows, setter] = createSignal(initial);
    setRows = setter;
    return (
      <AgentActivitySourceProvider
        value={{
          rows,
          isPending: () => false,
          hasMore: () => false,
          loadMore: () => {},
        }}
      >
        <AgentActivitySection />
      </AgentActivitySourceProvider>
    );
  });
  return {
    setRows: setRows!,
    section: document.querySelector(
      '[data-agent-activity-section]'
    ) as HTMLDivElement,
    list: document.querySelector(
      '[data-agent-activity-list]'
    ) as HTMLDivElement,
  };
}

describe('AgentActivitySection', () => {
  it('folds consecutive edits and expands a chronological timeline', () => {
    setup([
      row('3', 'a', 'edited'),
      row('2', 'a', 'edited'),
      row('1', 'a', 'created'),
    ]);
    expect(screen.getAllByText('Edited (x2)').length).toBeGreaterThan(0);
    const toggle = screen.getByRole('button', {
      name: 'Show activity for Example document',
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const labels = screen
      .getAllByText(/Created|Edited/)
      .map((element) => element.textContent);
    expect(labels.slice(-2)).toEqual(['Created', 'Edited (x2)']);
  });

  it('holds updates under the pointer and catches up with the pill', () => {
    const { setRows, section } = setup([row('1', 'a', 'created')]);
    fireEvent.pointerEnter(section);
    setRows([row('2', 'a', 'edited'), row('1', 'a', 'created')]);
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Edited')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 new' }));
    expect(screen.getAllByText('Edited').length).toBeGreaterThan(0);
  });

  it('catches up when the pointer leaves at the top and opens an updated entity', () => {
    const { setRows, section } = setup([row('1', 'a', 'created')]);
    fireEvent.pointerEnter(section);
    setRows([row('2', 'a', 'edited'), row('1', 'a', 'created')]);
    fireEvent.pointerLeave(section);
    expect(
      screen
        .getByRole('button', { name: 'Show activity for Example document' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.queryByRole('button', { name: '1 new' })).toBeNull();
  });

  it('keeps updates queued while focus remains in the list', () => {
    const { setRows, section } = setup([row('1', 'a', 'created')]);
    fireEvent.focusIn(section);
    setRows([row('2', 'b', 'edited'), row('1', 'a', 'created')]);
    expect(screen.getAllByText('Example document')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '1 new' })).toBeTruthy();
  });

  it('leaves a new entity closed after catch-up', () => {
    const { setRows } = setup([row('1', 'a', 'created')]);
    expect(screen.queryByLabelText('New activity')).toBeNull();
    setRows([row('2', 'b', 'created'), row('1', 'a', 'created')]);
    const items = document.querySelectorAll('[data-agent-activity-item]');
    expect(items).toHaveLength(2);
    expect(screen.getByLabelText('New activity')).toBeTruthy();
    // One step has nothing to expand, so the row has no accordion at all.
    expect(items[0]?.querySelector('[aria-expanded]')).toBeNull();
  });

  it('labels an unresolved type without offering an entity link', () => {
    setup([{ ...row('1', 'a', 'read'), entityType: 'team' }]);
    expect(screen.getByText('team')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'team' })).toBeNull();
  });

  it('keeps updates queued after the pointer leaves a list scrolled down', () => {
    const { setRows, section, list } = setup([row('1', 'a', 'created')]);
    list.scrollTop = 48;
    fireEvent.scroll(list);
    setRows([row('2', 'b', 'edited'), row('1', 'a', 'created')]);
    fireEvent.pointerLeave(section);
    expect(list.scrollTop).toBe(48);
    expect(screen.getByRole('button', { name: '1 new' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1 new' }));
    expect(list.scrollTop).toBe(0);
  });

  it('shows older loaded rows without calling them new activity', () => {
    const { setRows, section } = setup([row('2', 'a', 'edited')]);
    fireEvent.pointerEnter(section);
    setRows([row('2', 'a', 'edited'), row('1', 'b', 'created')]);
    expect(
      document.querySelectorAll('[data-agent-activity-item]')
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '1 new' })).toBeNull();
  });
});
