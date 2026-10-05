import type { TurnState } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInputProps } from '../ui/AgentInput';
import type { AgentModelSelectorProps } from '../ui/AgentModelSelector';
import type { QueuedPromptsProps } from '../ui/QueuedPrompts';
import { AgentComposer } from './AgentComposer';

const mocks = vi.hoisted(() => ({
  session: () => ({ canEdit: false as boolean | undefined }),
  turn: () => 'idle' as TurnState,
  issue: vi.fn(),
  selectModel: vi.fn(),
  sendNext: vi.fn(),
  steer: vi.fn(),
  editQueued: vi.fn(),
  removeQueued: vi.fn(),
  steerQueued: vi.fn(),
  upload: vi.fn(),
  consumeNotes: vi.fn(),
  input: undefined as AgentInputProps | undefined,
  model: undefined as AgentModelSelectorProps | undefined,
  queued: undefined as QueuedPromptsProps | undefined,
}));

vi.mock('@app/features/agent-changes/context/agent-changes-controller', () => ({
  useOptionalAgentChanges: () => ({ consumeSendableNotes: mocks.consumeNotes }),
}));
vi.mock('@channel/Input', () => ({
  createInputAttachmentTracker: () => ({
    attachments: () => [],
    clearAttachments: vi.fn(),
    removeAttachment: vi.fn(),
  }),
  uploadInputAttachments: mocks.upload,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    session: () => mocks.session(),
    displayName: (id: string) => id,
    userId: () => 'viewer',
    interactions: { pending: () => [], canAnswer: () => false },
    issue: mocks.issue,
    selectModel: mocks.selectModel,
    loadFailed: () => false,
    messages: () => [],
    metadata: () => undefined,
    pending: () => false,
    initialInput: 'Document context',
    queue: {
      entries: () => [
        { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
      ],
      edit: mocks.editQueued,
      remove: mocks.removeQueued,
      steer: mocks.steerQueued,
    },
    sendNext: mocks.sendNext,
    steer: mocks.steer,
    turn: () => mocks.turn(),
    registerQuoteInsert: vi.fn(),
  }),
}));
vi.mock('../ui', () => ({
  AgentInput: (props: AgentInputProps) => {
    mocks.input = props;
    return <div>{props.modelControl}</div>;
  },
  AgentModelSelector: (props: AgentModelSelectorProps) => {
    mocks.model = props;
    return null;
  },
  QueuedPrompts: (props: QueuedPromptsProps) => {
    mocks.queued = props;
    return null;
  },
  ComposerNotice: () => null,
}));
vi.mock('./PermissionRequest', () => ({ PermissionRequest: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.turn = () => 'idle';
  mocks.session = () => ({ canEdit: false });
  mocks.issue.mockResolvedValue({ isErr: () => false });
});
afterEach(cleanup);

it('passes opening context to the composer without issuing it', () => {
  render(() => <AgentComposer />);
  expect(mocks.input?.initialInput).toBe('Document context');
  expect(mocks.issue).not.toHaveBeenCalled();
});

describe('view-only session controls', () => {
  it('disables and guards prompt, model, stop, queue, and attachment actions', () => {
    render(() => <AgentComposer />);

    expect(mocks.input?.disabled).toBe(true);
    expect(mocks.input?.readOnly).toBe(true);
    expect(mocks.input?.placeholder).toBe(
      'You have view-only access to this agent session'
    );
    expect(mocks.model?.disabled).toBe(true);
    expect(mocks.queued?.disabled).toBe(true);

    mocks.input?.onSend('A new prompt', []);
    mocks.input?.onStop?.();
    mocks.input?.onSendNext?.();
    mocks.input?.onAttachFiles?.([new File(['text'], 'note.txt')]);
    mocks.model?.onSelect('new-model');
    mocks.queued?.onEdit('queued-1', 'Edited prompt');
    mocks.queued?.onRemove('queued-1');

    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
    expect(mocks.sendNext).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.consumeNotes).not.toHaveBeenCalled();
    mocks.queued?.onSteer?.('queued-1');
    expect(mocks.editQueued).not.toHaveBeenCalled();
    expect(mocks.removeQueued).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(mocks.queued?.onSteer).toBeUndefined();
  });

  it('steers one queued message while a turn is in flight', () => {
    mocks.session = () => ({ canEdit: true });
    mocks.turn = () => 'running';
    render(() => <AgentComposer />);

    expect(mocks.queued?.onSteer).toEqual(expect.any(Function));
    mocks.queued?.onSteer?.('queued-1');
    expect(mocks.steer).toHaveBeenCalledWith('queued-1');
  });

  it('reacts to a permission downgrade without remounting', () => {
    const [canEdit, setCanEdit] = createSignal(true);
    mocks.session = () => ({ canEdit: canEdit() });
    render(() => <AgentComposer />);
    expect(mocks.input?.disabled).toBe(false);
    expect(mocks.model?.disabled).toBe(false);

    setCanEdit(false);

    expect(mocks.input?.readOnly).toBe(true);
    expect(mocks.model?.disabled).toBe(true);
    expect(mocks.queued?.disabled).toBe(true);
    mocks.input?.onSend('Cannot send now', []);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
  });

  it.each([true, undefined])(
    'preserves editable drafts before a read-only result (%s)',
    (canEdit) => {
      mocks.session = () => ({ canEdit });
      render(() => <AgentComposer />);

      expect(mocks.input?.disabled).toBe(false);
      expect(mocks.input?.readOnly).toBe(false);
      expect(mocks.queued?.disabled).toBe(false);
      mocks.input?.onSend('A permitted prompt', []);
      expect(mocks.issue).toHaveBeenCalledWith({
        type: 'prompt',
        prompt: 'A permitted prompt',
      });
    }
  );
});

it('explicitly sends the queue head and disables it while the turn transitions', () => {
  const [turn, setTurn] = createSignal<TurnState>('running');
  mocks.turn = turn;
  mocks.session = () => ({ canEdit: true });
  render(() => <AgentComposer />);
  expect(mocks.queued?.onSteer).toEqual(expect.any(Function));
  const sendNext = screen.getByRole('button', {
    name: 'Send next queued message now',
  });
  fireEvent.click(sendNext);
  expect(mocks.sendNext).toHaveBeenCalledTimes(1);
  for (const next of ['stopping', 'starting'] as const) {
    setTurn(next);
    expect(sendNext.hasAttribute('disabled')).toBe(true);
    expect(mocks.queued?.onSteer).toBeUndefined();
    fireEvent.click(sendNext);
  }
  expect(mocks.sendNext).toHaveBeenCalledTimes(1);
});
