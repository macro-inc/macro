/**
 * @vitest-environment jsdom
 */

import type { PropertyDefinitionDomain } from '@property/types';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readActivityHandler } from './ReadActivity';

const STATUS_PROPERTY_ID = 'property-status';
const COMPLETED_OPTION_ID = 'option-completed';

const definitions = [
  {
    id: STATUS_PROPERTY_ID,
    displayName: 'Status',
    options: [
      {
        id: COMPLETED_OPTION_ID,
        value: { type: 'string', value: 'Completed' },
        color: 'rgb(16, 185, 129)',
      },
    ],
  } as unknown as PropertyDefinitionDomain,
];

vi.mock('@property/editor/hooks/useAllProperties', () => ({
  useAllProperties: () => () => definitions,
}));

vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: vi.fn(),
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: () => null,
  })
);

vi.mock('@property/hooks', () => ({
  usePropertyEntityDisplay: () => ({
    name: () => 'Launch plan',
    icon: () => null,
    isLoading: () => false,
    blockOrFileType: () => null,
    linkParams: () => undefined,
  }),
}));

function renderTool(
  activities: NamedTool<'ReadActivity', 'response'>['data']['activities']
) {
  const tool: NamedTool<'ReadActivity', 'call'> = {
    id: 'tool-1',
    name: 'ReadActivity',
    data: {
      from: '2026-08-18T17:30:00Z',
      to: '2026-08-19T17:30:00Z',
    },
  };
  const response: NamedTool<'ReadActivity', 'response'> = {
    id: 'tool-1',
    name: 'ReadActivity',
    data: { activities, truncated: false },
  };

  return render(() => (
    <Dynamic
      component={
        readActivityHandler.render as Component<Record<string, unknown>>
      }
      tool={tool}
      response={response}
      chat_id="chat-1"
      message_id="message-1"
      part_index={0}
      isComplete
      renderContext={{ isStreaming: false, grouped: false }}
    />
  ));
}

afterEach(cleanup);

describe('ReadActivity renderer', () => {
  it('reuses activity property and entity display resolution', async () => {
    const { container } = renderTool([
      {
        actorId: 'macro|user@example.com',
        entityType: 'document',
        entityId: 'document-raw-id',
        action: {
          type: 'propertyChanged',
          property: STATUS_PROPERTY_ID,
          to: {
            type: 'SelectOption',
            value: [COMPLETED_OPTION_ID],
          },
        },
        occurredAt: '2026-08-19T17:30:00Z',
      },
    ]);

    const toggle = screen.getByRole('button', { name: /1 activity/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    expect(container.textContent).toContain('Changed');
    expect(container.textContent).toContain('Status');
    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('Launch plan');
    expect(container.textContent).not.toContain(STATUS_PROPERTY_ID);
    expect(container.textContent).not.toContain(COMPLETED_OPTION_ID);
    expect(container.textContent).not.toContain('document-raw-id');
  });

  it('renders an unsupported entity type without leaking the raw id', () => {
    const { container } = renderTool([
      {
        actorId: 'macro|user@example.com',
        entityType: 'agent_session',
        entityId: 'agent-session-raw-id',
        action: { type: 'created' },
        occurredAt: '2026-08-19T17:30:00Z',
      },
    ]);

    expect(screen.getByRole('button', { name: /1 activity/i })).toBeTruthy();
    expect(container.textContent).toContain('Created');
    expect(container.textContent).not.toContain('agent-session-raw-id');
  });

  it('reports an empty range without an expand control', () => {
    renderTool([]);

    expect(screen.getByText('No Results')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /activity/i })).toBeNull();
  });
});
