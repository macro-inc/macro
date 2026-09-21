/**
 * @vitest-environment jsdom
 *
 * Details lists a harness for coding runtimes and omits it for in-memory
 * chat agents — that row is the only user-facing "Harness" mention here.
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSidePanelSections } from './AgentSidePanelSections';

const session = vi.hoisted(() => ({
  harness: 'in-memory' as string | undefined,
  botId: undefined as string | undefined,
}));

vi.mock('../../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    session: () => ({
      harness: session.harness,
      botId: session.botId,
    }),
    bot: () => ({ name: 'Macro' }),
    metadata: () => undefined,
    messages: () => [],
  }),
}));

vi.mock('@app/features/agent-changes/context/agent-changes-controller', () => ({
  useOptionalAgentChanges: () => undefined,
}));

vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Section: (props: { children: JSX.Element }) => props.children,
    Grid: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Row: (props: { label: string; children: JSX.Element }) => (
      <div>
        <span>{props.label}</span>
        {props.children}
      </div>
    ),
    Pill: (props: { children: JSX.Element }) => <span>{props.children}</span>,
    CountTitle: (props: { label: string }) => <span>{props.label}</span>,
  },
}));

vi.mock('../../ui', () => ({
  SessionStatusPill: () => <span>Starting</span>,
  CountSummary: () => null,
  TodoList: () => null,
}));

afterEach(cleanup);

describe('AgentSidePanelSections', () => {
  it('does not mention harness for in-memory agents', () => {
    session.harness = 'in-memory';
    session.botId = undefined;
    render(() => <AgentSidePanelSections />);
    expect(screen.queryByText('Harness')).toBeNull();
    expect(screen.queryByText('In Memory')).toBeNull();
  });

  it('lists the harness for a coding runtime', () => {
    session.harness = 'cursor';
    session.botId = undefined;
    render(() => <AgentSidePanelSections />);
    expect(screen.getByText('Harness')).toBeTruthy();
    expect(screen.getByText('Cursor')).toBeTruthy();
  });
});
