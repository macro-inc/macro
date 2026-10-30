import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import { DatabaseTimelineView } from './database-timeline-view';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const dates: DatabaseViewColumn = {
  id: 'dates',
  name: 'Dates',
  dataType: 'DATE_RANGE',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const stage: DatabaseViewColumn = {
  id: 'stage',
  name: 'Stage',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [
    { id: 'plan', label: 'Plan', color: null },
    { id: 'build', label: 'Build', color: null },
  ],
  writable: true,
};
const rows = [
  {
    rowId: 'launch',
    cells: {
      name: 'Launch',
      dates: '2026-03-02T00:00:00.000Z/2026-03-06T00:00:00.000Z',
      stage: 'Build',
    },
  },
  {
    rowId: 'research',
    cells: { name: 'Research', dates: null, stage: 'Plan' },
  },
];

async function selectMenu(name: string) {
  const item = await screen.findByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

let menuStyles: HTMLStyleElement;
// The chart's virtual rows need a viewport with room for them.
// Times read in New York, whatever the machine's zone.
const systemTimeZone = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  menuStyles = document.createElement('style');
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
  document.head.append(menuStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1000, 600)
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
});
afterEach(() => {
  process.env.TZ = systemTimeZone;
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('draws a bar for each dated record and a chip for each undated one, opening either, with the drawer closed', () => {
  const onOpen = vi.fn();
  render(() => (
    <DatabaseTimelineView
      view={{
        query: { filter: null, sort: [] },
        layout: {
          kind: 'timeline',
          range: 'dates',
          title: 'name',
          groupBy: null,
          colorBy: null,
        },
      }}
      rows={rows}
      columns={[name, dates, stage]}
      canEdit
      filtered={false}
      rowPending={() => false}
      onOpen={onOpen}
      onCreate={async () => true}
      onWrite={async () => true}
    />
  ));
  expect(screen.getByText('Undated')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'Show timeline items' })
      .getAttribute('aria-expanded')
  ).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: /^Launch: Mar 2, 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Research: No dates' }));
  expect(onOpen.mock.calls).toEqual([['launch'], ['research']]);
});

it('shows a timed bar’s hours and its fields after its title', () => {
  render(() => (
    <DatabaseTimelineView
      view={{
        query: { filter: null, sort: [] },
        layout: {
          kind: 'timeline',
          range: 'dates',
          title: 'name',
          groupBy: null,
          colorBy: null,
          barFields: ['stage'],
        },
      }}
      rows={[
        {
          rowId: 'standup',
          cells: {
            name: 'Standup',
            dates: '2026-03-02T14:30:00.000Z/2026-03-02T21:00:00.000Z',
            stage: 'Build',
          },
        },
      ]}
      columns={[name, dates, stage]}
      canEdit
      filtered={false}
      rowPending={() => false}
      onOpen={() => {}}
      onCreate={async () => true}
      onWrite={async () => true}
    />
  ));
  const bar = screen.getByRole('button', { name: /^Standup: / });
  expect(bar.textContent).toBe('Standup9:30 AM – 4 PMBuild');
});

it('offers a viewer only Open record from a bar’s menu', async () => {
  const onOpen = vi.fn();
  render(() => (
    <DatabaseTimelineView
      view={{
        query: { filter: null, sort: [] },
        layout: {
          kind: 'timeline',
          range: 'dates',
          title: 'name',
          groupBy: 'stage',
          colorBy: null,
        },
      }}
      rows={rows}
      columns={[name, dates, stage]}
      canEdit={false}
      filtered={false}
      rowPending={() => false}
      onOpen={onOpen}
      onCreate={async () => true}
      onWrite={async () => true}
    />
  ));
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /^Launch: Mar 2, 2026/ })
  );
  const items = await screen.findAllByRole('menuitem');
  expect(items.map((item) => item.textContent)).toEqual(['Open record']);
  await selectMenu('Open record');
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith('launch'));
});

it('lets an editor remove a bar’s dates and date a chip from the keyboard menu', async () => {
  const onWrite = vi.fn(async () => true);
  render(() => (
    <DatabaseTimelineView
      view={{
        query: { filter: null, sort: [] },
        layout: {
          kind: 'timeline',
          range: 'dates',
          title: 'name',
          groupBy: 'stage',
          colorBy: null,
        },
      }}
      rows={rows}
      columns={[name, dates, stage]}
      canEdit
      filtered={false}
      rowPending={() => false}
      onOpen={() => {}}
      onCreate={async () => true}
      onWrite={onWrite}
      onDuplicate={async () => true}
      onRequestDelete={() => {}}
    />
  ));
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /^Launch: Mar 2, 2026/ })
  );
  const items = await screen.findAllByRole('menuitem');
  expect(items.map((item) => item.textContent)).toEqual([
    'Open record',
    'Edit time range…',
    'Rename',
    'Move to group',
    'Remove dates',
    'Duplicate',
    'Delete record',
  ]);
  await selectMenu('Remove dates');
  await waitFor(() =>
    expect(onWrite).toHaveBeenCalledWith('launch', 'dates', null)
  );

  const chip = screen.getByRole('button', { name: 'Research: No dates' });
  chip.focus();
  fireEvent.keyDown(chip, { key: 'F10', shiftKey: true });
  await selectMenu('Add dates');
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  await waitFor(() =>
    expect(onWrite).toHaveBeenLastCalledWith(
      'research',
      'dates',
      `${day}/${day}`
    )
  );
});

it('groups records under every option and collapses a group', () => {
  render(() => (
    <DatabaseTimelineView
      view={{
        query: { filter: null, sort: [] },
        layout: {
          kind: 'timeline',
          range: 'dates',
          title: 'name',
          groupBy: 'stage',
          colorBy: null,
        },
      }}
      rows={rows}
      columns={[name, dates, stage]}
      canEdit
      filtered={false}
      rowPending={() => false}
      onOpen={() => {}}
      onCreate={async () => true}
      onWrite={async () => true}
    />
  ));
  expect(screen.getByText('No stage')).toBeTruthy();
  const build = screen.getByText('Build').closest('button')!;
  expect(build.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByTitle('Launch')).toBeTruthy();
  fireEvent.click(build);
  expect(build.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByTitle('Launch')).toBeNull();
});

it('tells a viewer when the view has no records, and offers the way back when the dates are gone', () => {
  const onViewChange = vi.fn();
  render(() => (
    <>
      <DatabaseTimelineView
        view={{
          query: { filter: null, sort: [] },
          layout: {
            kind: 'timeline',
            range: 'dates',
            title: 'name',
            groupBy: null,
            colorBy: null,
          },
        }}
        rows={[]}
        columns={[name, dates]}
        canEdit={false}
        filtered
        rowPending={() => false}
        onOpen={() => {}}
        onCreate={async () => true}
        onWrite={async () => true}
      />
      <DatabaseTimelineView
        view={{
          query: { filter: null, sort: [] },
          layout: {
            kind: 'timeline',
            range: 'removed',
            title: 'name',
            groupBy: null,
            colorBy: null,
          },
        }}
        rows={rows}
        columns={[name]}
        canEdit
        filtered={false}
        onViewChange={onViewChange}
        rowPending={() => false}
        onOpen={() => {}}
        onCreate={async () => true}
        onWrite={async () => true}
      />
    </>
  ));
  expect(screen.getByText('No records match this view.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open table' }));
  expect(onViewChange).toHaveBeenCalledWith({
    layout: { kind: 'table', columns: [] },
  });
});
