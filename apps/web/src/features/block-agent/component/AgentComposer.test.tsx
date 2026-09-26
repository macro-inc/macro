import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInputProps } from '../ui/AgentInput';
import type { AgentModelSelectorProps } from '../ui/AgentModelSelector';
import type { QueuedPromptsProps } from '../ui/QueuedPrompts';
import { AgentComposer } from './AgentComposer';

const mocks = vi.hoisted(() => ({
  session: () => ({ canEdit: false as boolean | undefined }),
  issue: vi.fn(),
  selectModel: vi.fn(),
  sendNext: vi.fn(),
  editQueued: vi.fn(),
  removeQueued: vi.fn(),
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
    queue: {
      entries: () => [
        { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
      ],
      edit: mocks.editQueued,
      remove: mocks.removeQueued,
    },
    sendNext: mocks.sendNext,
    turn: () => 'idle',
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
  mocks.session = () => ({ canEdit: false });
  mocks.issue.mockResolvedValue({ isErr: () => false });
});
afterEach(cleanup);

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
    expect(mocks.editQueued).not.toHaveBeenCalled();
    expect(mocks.removeQueued).not.toHaveBeenCalled();
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
