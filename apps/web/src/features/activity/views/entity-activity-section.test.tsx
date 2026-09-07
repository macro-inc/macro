import type { ActivityEventFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityContextProvider } from '../context/activity-context';
import {
  createdEvent,
  editedEvent,
  openedEvent,
  propertyChangedEvent,
} from '../queries/fixtures';
import { createMockActivityContext } from '../tests/mock-context';
import { soupPage } from '../tests/wire';
import { EntityActivitySection } from './entity-activity-section';

// The section registers with the side panel accordion, which needs the
// panel layout; here only the section body is under test.
vi.mock('@components/app/side-panel/SidePanel', () => ({
  SidePanel: {
    Section: (props: { children: JSX.Element }) => props.children,
    Loading: () => <div data-loading />,
    EmptyPill: (props: { label: string }) => <span>{props.label}</span>,
  },
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: () => null,
  })
);

vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));

afterEach(cleanup);

function renderSection() {
  const context = createMockActivityContext();
  const result = render(() => (
    <ActivityContextProvider value={context}>
      <EntityActivitySection entityId="doc-1" entityType="DOCUMENT" />
    </ActivityContextProvider>
  ));
  return { ...result, graphql: context.graphqlMock };
}

function resolve(
  graphql: ReturnType<typeof renderSection>['graphql'],
  activity: ActivityEventFieldsFragment[]
) {
  graphql
    .latest('EntityActivity')
    .resolve(
      soupPage([{ __typename: 'GraphqlSoupDocument', id: 'doc-1', activity }])
    );
}

const rows = () => document.querySelectorAll('[data-activity-row]');
const at = (id: string, event: ActivityEventFieldsFragment) => ({
  ...event,
  id,
});

// Newest first: three edits fold into one run, then four singles, with the
// creation row oldest. Six entries for eight events.
const HISTORY: ActivityEventFieldsFragment[] = [
  at('e8', editedEvent),
  at('e7', editedEvent),
  at('e6', editedEvent),
  at('e5', openedEvent),
  at('e4', editedEvent),
  at('e3', propertyChangedEvent),
  at('e2', openedEvent),
  at('e1', createdEvent),
];

describe('EntityActivitySection', () => {
  it('shows every entry unfolded when the history is short', () => {
    const { container, graphql } = renderSection();
    resolve(graphql, HISTORY.slice(4));

    expect(rows()).toHaveLength(4);
    expect(container.querySelector('[data-activity-fold-toggle]')).toBeNull();
  });

  it('folds to three newest entries, a toggle, and the pinned creation row', () => {
    const { container, graphql } = renderSection();
    resolve(graphql, HISTORY);

    const visible = rows();
    expect(visible).toHaveLength(4);
    expect(visible[0]?.getAttribute('data-activity-run-size')).toBe('3');
    expect(visible[0]?.textContent).toContain('3 times');
    expect(visible[1]?.getAttribute('data-activity-action')).toBe('opened');
    expect(visible[2]?.getAttribute('data-activity-action')).toBe('edited');
    expect(visible[3]?.getAttribute('data-activity-action')).toBe('created');

    const toggle = screen.getByRole('button', { name: 'View all activities' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Show all');

    fireEvent.click(toggle);
    expect(rows()).toHaveLength(6);
    expect(
      screen
        .getByRole('button', { name: 'Show less' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(rows()[5]?.getAttribute('data-activity-action')).toBe('created');

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(rows()).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: 'View all activities' })
    ).toBeTruthy();
  });

  it('reads compact rows with the actor, the phrase, and an inline time', () => {
    const { graphql } = renderSection();
    resolve(graphql, [at('e1', createdEvent)]);

    const row = rows()[0];
    if (!row) throw new Error('row not rendered');
    expect(row.textContent).toContain('sarah');
    expect(row.textContent).toContain('created this');
    expect(row.querySelector('time')).not.toBeNull();
    expect(row.textContent).toContain('·');
  });

  it('shows the empty and error states', () => {
    const empty = renderSection();
    resolve(empty.graphql, []);
    expect(empty.container.textContent).toContain('No activity yet');
    cleanup();

    const failed = renderSection();
    failed.graphql.latest('EntityActivity').fail('boom');
    expect(failed.container.textContent).toContain('Activity is unavailable');
  });
});
