/**
 * @vitest-environment jsdom
 */

import type { InteractionResponse } from '@app/features/agent-interactions/context/interaction';
import type {
  FoldedMessage,
  PendingPermission,
} from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const respond = vi.fn<(response: InteractionResponse) => Promise<boolean>>();
let canAnswer = true;

const request: PendingPermission = {
  requestId: 'perm-1',
  turn: 3,
  toolCall: 'toolu_doc',
  options: [
    { id: 'once', name: 'Allow this time', kind: 'allow_once' },
    { id: 'no', name: 'Deny', kind: 'reject_once' },
  ],
};

const reply: FoldedMessage = {
  agentSessionId: 'session',
  turn: 3,
  author: { kind: 'agent' },
  requestId: null,
  parts: [
    {
      kind: 'tool_use',
      id: 'toolu_doc',
      name: { kind: 'mcp', server: 'macro', tool: 'CreateDocument' },
      status: 'pending',
      detail: {
        kind: 'macro',
        input: { documentName: 'Launch FAQ' },
        output: null,
        error: null,
      },
    },
  ],
  stop: null,
  pending: false,
  segments: [
    {
      index: 0,
      kind: 'activity',
      start: 0,
      end: 1,
      sealed: false,
      rows: [
        {
          id: 'toolu_doc',
          label: 'Create document',
          detail: 'Launch FAQ',
          status: 'running',
        },
      ],
    },
  ],
  phase: 'waiting',
  postedAt: null,
};

// The approval card is the layer under test; the draft card and the
// composers a question can open reach the app's live connections, which
// jsdom cannot open.
vi.mock('@app/features/agent-interactions/components/DraftCard', () => ({
  DraftCard: () => null,
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: () => null,
}));
vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: () => null,
}));

vi.mock('../context/AgentSessionContext', () => ({
  useOptionalAgentSession: () => ({
    messages: () => [reply],
    interactions: {
      pending: () => [{ kind: 'permission', ...request }],
      canAnswer: () => canAnswer,
      answerers: 'someone who can edit this session',
      owns: () => true,
      answering: () => false,
      respond,
      draft: () => undefined,
      keepDraft: () => {},
    },
  }),
}));

import { PermissionRequest } from './PermissionRequest';

beforeEach(() => {
  respond.mockReset();
  respond.mockResolvedValue(true);
  canAnswer = true;
});
afterEach(cleanup);

it('asks in the words of the step, with the raw input folded away', () => {
  const view = render(() => <PermissionRequest request={request} />);
  expect(view.getByRole('region', { name: 'Permission request' })).toBeTruthy();
  expect(view.getByText('Create document')).toBeTruthy();
  expect(view.getByText('Launch FAQ')).toBeTruthy();
  expect(view.queryByText(/"documentName"/)).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Show input' }));
  expect(view.getByText(/"documentName": "Launch FAQ"/)).toBeTruthy();
});

it('answers with the option chosen', () => {
  const view = render(() => <PermissionRequest request={request} />);
  fireEvent.click(view.getByRole('button', { name: 'Allow once' }));
  expect(respond).toHaveBeenCalledWith({
    ...request,
    kind: 'permission',
    answer: { kind: 'selected', optionId: 'once' },
  });
});

it('tells a viewer who cannot answer who can, with nothing to press', () => {
  canAnswer = false;
  const view = render(() => <PermissionRequest request={request} />);
  expect(
    view.getByText('Waiting for someone who can edit this session to approve')
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull();
});
