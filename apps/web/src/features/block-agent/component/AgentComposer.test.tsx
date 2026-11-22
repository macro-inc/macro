import type { InputAttachmentData } from '@channel/Input';
import { setPreferredSpeed } from '@core/component/AI/signal/speed';
import type { TurnState } from '@service-agent-fold/generated/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { createSignal, mergeProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedModelSelectorState } from '../../agents-view/components/unified-model-selector/root';
import type { AgentInputProps } from '../ui/AgentInput';
import type { QueuedPromptsProps } from '../ui/QueuedPrompts';
import { AgentComposer } from './AgentComposer';

const speedOption = (values: string[]) => ({
  id: 'speed',
  name: 'Priority tier',
  category: null,
  description: null,
  type: 'select',
  currentValue: values[0],
  options: values.map((value) => ({
    value,
    name: value,
    group: null,
    description: null,
  })),
});

const mocks = vi.hoisted(() => ({
  session: (): { canEdit?: boolean; harness?: string } => ({ canEdit: false }),
  sessionId: (): string => 'session-1',
  unconfirmed: (): { actionId: string; action: unknown }[] => [],
  dropUnconfirmed: vi.fn(),
  turn: () => 'idle' as TurnState,
  issue: vi.fn(),
  selectModel: vi.fn(),
  steer: vi.fn(),
  editQueued: vi.fn(),
  removeQueued: vi.fn(),
  steerQueued: vi.fn(),
  upload: vi.fn(),
  consumeNotes: vi.fn(),
  toastFailure: vi.fn(),
  metadata: () =>
    undefined as { model: string; configOptions: unknown[] } | undefined,
  input: undefined as AgentInputProps | undefined,
  model: undefined as UnifiedModelSelectorState | undefined,
  queued: undefined as QueuedPromptsProps | undefined,
}));

vi.mock('@app/features/changes/context/changes-controller', () => ({
  useOptionalChanges: () => ({ consumeSendableNotes: mocks.consumeNotes }),
}));
vi.mock('@channel/Input', () => ({
  uploadInputAttachments: mocks.upload,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    session: () => mocks.session(),
    displayName: (id: string) => id,
    userId: () => 'viewer',
    interactions: { pending: () => [], canAnswer: () => false },
    toolApprovals: { pending: () => [] },
    issue: mocks.issue,
    selectModel: mocks.selectModel,
    loadFailed: () => false,
    messages: () => [],
    metadata: () => mocks.metadata(),
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
    steer: mocks.steer,
    steerFailed: () => new Set(),
    turn: () => mocks.turn(),
    sessionId: () => mocks.sessionId(),
    unconfirmed: () => mocks.unconfirmed(),
    dropUnconfirmed: mocks.dropUnconfirmed,
    registerQuoteInsert: vi.fn(),
  }),
}));
vi.mock('../ui', () => ({
  AgentInput: (props: AgentInputProps) => {
    mocks.input = props;
    return <div>{props.modelControl}</div>;
  },
  QueuedPrompts: (props: QueuedPromptsProps) => {
    mocks.queued = props;
    return null;
  },
  ComposerNotice: (props: { text: string }) => <p>{props.text}</p>,
  UnconfirmedSendCard: (props: {
    text: string;
    onSendAgain: () => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="unconfirmed">
      <p>{props.text}</p>
      <button type="button" onClick={() => props.onSendAgain()}>
        Send anyway
      </button>
      <button type="button" onClick={() => props.onDismiss()}>
        Dismiss
      </button>
    </div>
  ),
}));
vi.mock('@app/features/agents-view/model-selector', () => ({
  UnifiedModelSelector: (props: { state: UnifiedModelSelectorState }) => {
    mocks.model = mergeProps(() => props.state);
    return null;
  },
}));
vi.mock('./PermissionRequest', () => ({ PermissionRequest: () => null }));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  mocks.turn = () => 'idle';
  mocks.metadata = () => undefined;
  mocks.sessionId = () => 'session-1';
  mocks.unconfirmed = () => [];
  mocks.session = () => ({ canEdit: false });
  mocks.issue.mockResolvedValue({ isErr: () => false });
  setPreferredSpeed('priority');
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
    mocks.input?.onAttachFiles?.([new File(['text'], 'note.txt')]);
    mocks.model?.onModel('new-model');
    // Read-only: the edit is not sent, so nothing is there to await.
    expect(mocks.queued?.onEdit('queued-1', 'Edited prompt')).toBeUndefined();
    mocks.queued?.onRemove('queued-1');

    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
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
      expect(mocks.issue).toHaveBeenCalledWith(
        {
          type: 'prompt',
          prompt: 'A permitted prompt',
        },
        { onChecking: expect.any(Function) }
      );
    }
  );
});

it('keeps steering queued messages while the turn transitions', () => {
  const [turn, setTurn] = createSignal<TurnState>('running');
  mocks.turn = turn;
  mocks.session = () => ({ canEdit: true });
  render(() => <AgentComposer />);
  expect(mocks.queued?.onSteer).toEqual(expect.any(Function));
  for (const next of ['stopping', 'starting'] as const) {
    setTurn(next);
    expect(mocks.queued?.onSteer).toEqual(expect.any(Function));
  }
});

it('retains an unsent draft when speed configuration is rejected', async () => {
  mocks.session = () => ({ canEdit: true, harness: 'in-memory' });
  mocks.metadata = () => ({
    model: 'openai/gpt-6-astra',
    configOptions: [speedOption(['standard', 'priority', 'ultrafast'])],
  });
  mocks.selectModel.mockRejectedValue(new Error('Unavailable'));
  render(() => <AgentComposer />);
  mocks.input?.onDraftChange?.('Keep this draft');
  mocks.input?.onDraftChange?.('');
  mocks.input?.onSend('Keep this draft', []);
  await vi.waitFor(() => expect(mocks.input?.draft).toBe('Keep this draft'));
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.consumeNotes).not.toHaveBeenCalled();
});

it('skips the tier round trip when the session already runs the preferred tier', () => {
  mocks.session = () => ({ canEdit: true, harness: 'in-memory' });
  setPreferredSpeed('standard');
  mocks.metadata = () => ({
    model: 'openai/gpt-6-astra',
    configOptions: [speedOption(['standard', 'priority'])],
  });
  render(() => <AgentComposer />);
  mocks.input?.onSend('Standard is current', []);
  expect(mocks.selectModel).not.toHaveBeenCalled();
});

it.each([
  ['macrod', ['standard', 'priority', 'fast']],
  ['in-memory', ['default', 'turbo']],
])('leaves %s speed values %j alone', (harness, values) => {
  mocks.session = () => ({ canEdit: true, harness });
  mocks.metadata = () => ({
    model: 'external/model',
    configOptions: [speedOption(values)],
  });
  render(() => <AgentComposer />);
  mocks.input?.onSend('Use external settings', []);
  expect(mocks.selectModel).not.toHaveBeenCalled();
  expect(mocks.issue).toHaveBeenCalledWith(
    {
      type: 'prompt',
      prompt: 'Use external settings',
    },
    { onChecking: expect.any(Function) }
  );
});

it('retains the draft if editing access is revoked while applying speed', async () => {
  const [canEdit, setCanEdit] = createSignal(true);
  mocks.session = () => ({ canEdit: canEdit(), harness: 'in-memory' });
  mocks.metadata = () => ({
    model: 'openai/gpt-6-astra',
    configOptions: [speedOption(['standard', 'priority', 'ultrafast'])],
  });
  let finish!: () => void;
  mocks.selectModel.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(() => <AgentComposer />);
  mocks.input?.onDraftChange?.('');
  mocks.input?.onSend('Keep after permission change', []);
  expect(mocks.selectModel).toHaveBeenCalledWith('openai/gpt-6-astra', {
    configId: 'speed',
    value: 'priority',
  });
  setCanEdit(false);
  finish();
  await vi.waitFor(() =>
    expect(mocks.input?.draft).toBe('Keep after permission change')
  );
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.consumeNotes).not.toHaveBeenCalled();
});

it('keeps text typed while a rejected speed change was out', async () => {
  mocks.session = () => ({ canEdit: true, harness: 'in-memory' });
  mocks.metadata = () => ({
    model: 'openai/gpt-6-astra',
    configOptions: [speedOption(['standard', 'priority', 'ultrafast'])],
  });
  let fail!: () => void;
  mocks.selectModel.mockImplementation(
    () =>
      new Promise<void>((_, reject) => {
        fail = () => reject(new Error('Unavailable'));
      })
  );
  render(() => <AgentComposer />);
  mocks.input?.onDraftChange?.('');
  mocks.input?.onSend('First message', []);
  mocks.input?.onDraftChange?.('Typed meanwhile');
  fail();

  await vi.waitFor(() =>
    expect(mocks.input?.draft).toBe('First message\n\nTyped meanwhile')
  );
  expect(mocks.issue).not.toHaveBeenCalled();
});

it('keeps text typed while access was revoked during a speed change', async () => {
  const [canEdit, setCanEdit] = createSignal(true);
  mocks.session = () => ({ canEdit: canEdit(), harness: 'in-memory' });
  mocks.metadata = () => ({
    model: 'openai/gpt-6-astra',
    configOptions: [speedOption(['standard', 'priority', 'ultrafast'])],
  });
  let finish!: () => void;
  mocks.selectModel.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(() => <AgentComposer />);
  mocks.input?.onDraftChange?.('');
  mocks.input?.onSend('First message', []);
  mocks.input?.onDraftChange?.('Typed meanwhile');
  setCanEdit(false);
  finish();

  await vi.waitFor(() =>
    expect(mocks.input?.draft).toBe('First message\n\nTyped meanwhile')
  );
  expect(mocks.issue).not.toHaveBeenCalled();
});

it('allows another prompt after a failed turn', () => {
  mocks.session = () => ({ canEdit: true });
  mocks.turn = () => 'failed';
  render(() => <AgentComposer />);

  expect(mocks.input?.busy).toBe(false);
  mocks.input?.onSend('Try again', []);
  expect(mocks.issue).toHaveBeenCalledWith(
    {
      type: 'prompt',
      prompt: 'Try again',
    },
    { onChecking: expect.any(Function) }
  );
});

describe('a message the harness does not take', () => {
  const attachment: InputAttachmentData = {
    id: 'file-1',
    name: 'notes.txt',
    kind: 'document',
  };

  // The real input clears itself before handing the message over.
  const sendFromInput = (
    text: string,
    attachments: InputAttachmentData[] = []
  ) => {
    mocks.input?.onDraftChange?.('');
    mocks.input?.onSend(text, attachments);
  };

  beforeEach(() => {
    mocks.session = () => ({ canEdit: true, harness: 'macrod' });
  });

  it('keeps the draft when the agent has no runtime to run it on', async () => {
    mocks.issue.mockResolvedValue(
      err([
        {
          code: 'NO_RUNTIME_ACCESS',
          message: 'The agent is not connected to a computer',
        },
      ])
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    await vi.waitFor(() => expect(mocks.input?.draft).toBe('Run the tests'));
    // The transcript says why; a toast would say it twice.
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('says above the input why the message came back, until the next send', async () => {
    let answer!: (result: unknown) => void;
    mocks.issue.mockResolvedValueOnce(
      err([
        {
          code: 'NO_RUNTIME_ACCESS',
          message: 'This agent runs on a machine that is not connected.',
        },
      ])
    );
    mocks.issue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    expect(
      await screen.findByText(
        'Not sent: This agent runs on a machine that is not connected.'
      )
    ).toBeTruthy();
    // A polite live region, so a screen reader hears why the text came back.
    expect(screen.getByRole('status').textContent).toBe(
      'Not sent: This agent runs on a machine that is not connected.'
    );
    // Editing the message keeps the reason; sending it clears it, even before
    // the input has emptied itself.
    mocks.input?.onDraftChange?.('Run the tests again');
    expect(screen.queryByText(/^Not sent:/)).toBeTruthy();
    mocks.input?.onSend('Run the tests again', []);
    expect(screen.queryByText(/^Not sent:/)).toBeNull();
    answer(ok({ status: 'accepted', actionId: 'a' }));
  });

  it('drops the reason when the composer moves to another session', async () => {
    const [session, setSession] = createSignal('session-1');
    mocks.sessionId = session;
    mocks.issue.mockResolvedValue(
      err([{ code: 'NO_RUNTIME_ACCESS', message: 'Not connected.' }])
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    expect(await screen.findByText('Not sent: Not connected.')).toBeTruthy();
    setSession('session-2');
    expect(screen.queryByText(/^Not sent:/)).toBeNull();
  });

  it('keeps an earlier reason when a later send fails without one', async () => {
    let answer!: (result: unknown) => void;
    mocks.issue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    mocks.issue.mockResolvedValueOnce(
      err([{ code: 'NO_RUNTIME_ACCESS', message: 'Not connected.' }])
    );
    render(() => <AgentComposer />);
    sendFromInput('First message');
    sendFromInput('Second message');
    expect(await screen.findByText('Not sent: Not connected.')).toBeTruthy();

    answer(err([{ code: 'HTTP_ERROR' }]));
    await vi.waitFor(() => expect(mocks.toastFailure).toHaveBeenCalled());
    expect(screen.queryByText('Not sent: Not connected.')).toBeTruthy();
  });

  it('keeps the reason while the returned files are still there', async () => {
    mocks.issue.mockResolvedValue(
      err([{ code: 'NO_RUNTIME_ACCESS', message: 'Not connected.' }])
    );
    render(() => <AgentComposer />);
    sendFromInput('', [attachment]);

    expect(await screen.findByText('Not sent: Not connected.')).toBeTruthy();
    mocks.input?.onDraftChange?.('x');
    mocks.input?.onDraftChange?.('');
    expect(screen.queryByText('Not sent: Not connected.')).toBeTruthy();
  });

  it('drops the reason once the returned message is cleared away', async () => {
    mocks.issue.mockResolvedValue(
      err([{ code: 'NO_RUNTIME_ACCESS', message: 'Not connected.' }])
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    expect(await screen.findByText('Not sent: Not connected.')).toBeTruthy();
    mocks.input?.onDraftChange?.('');
    expect(screen.queryByText(/^Not sent:/)).toBeNull();
  });

  it('keeps the draft and says so when the send fails', async () => {
    mocks.issue.mockResolvedValue(err([{ code: 'HTTP_ERROR' }]));
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    await vi.waitFor(() => expect(mocks.input?.draft).toBe('Run the tests'));
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'The message could not be sent'
    );
    // The toast says it; there is no reason to repeat above the input.
    expect(screen.queryByText(/^Not sent:/)).toBeNull();
  });

  it('keeps the draft when the request throws', async () => {
    mocks.issue.mockRejectedValue(new Error('offline'));
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    await vi.waitFor(() => expect(mocks.input?.draft).toBe('Run the tests'));
  });

  it('puts the refused message before what was typed meanwhile', async () => {
    let answer!: (result: unknown) => void;
    mocks.issue.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    render(() => <AgentComposer />);
    sendFromInput('First message');
    mocks.input?.onDraftChange?.('Second thought');
    answer(err([{ code: 'HTTP_ERROR' }]));

    await vi.waitFor(() =>
      expect(mocks.input?.draft).toBe('First message\n\nSecond thought')
    );
  });

  it('gives back the files that rode the refused message', async () => {
    mocks.issue.mockResolvedValue(err([{ code: 'HTTP_ERROR' }]));
    render(() => <AgentComposer />);
    sendFromInput('With a file', [attachment]);

    await vi.waitFor(() =>
      expect(mocks.input?.attachments).toEqual([attachment])
    );
  });

  it('says it is checking while a lost send is looked for, then keeps the box empty', async () => {
    let answer!: (result: unknown) => void;
    mocks.issue.mockImplementation(
      (_action: unknown, options: { onChecking?: () => void }) =>
        new Promise((resolve) => {
          options.onChecking?.();
          answer = resolve;
        })
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    expect(
      await screen.findByText('Checking whether it was sent…')
    ).toBeTruthy();
    expect(mocks.input?.draft).toBe('');
    answer(ok({ status: 'sent', actionId: 'a' }));
    await vi.waitFor(() =>
      expect(screen.queryByText('Checking whether it was sent…')).toBeNull()
    );
    expect(mocks.input?.draft).toBe('');
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('keeps an unconfirmed send out of the box', async () => {
    mocks.issue.mockResolvedValue(
      err([
        {
          code: 'SEND_OUTCOME_UNKNOWN',
          message: "We couldn't confirm it was sent; check the conversation.",
          actionId: 'a',
        },
      ])
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    await vi.waitFor(() => expect(mocks.issue).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.input?.draft).toBe('');
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('keeps an unconfirmed prompt on a card and sends it again only when asked', async () => {
    const action = { type: 'prompt', prompt: 'Run the tests' };
    mocks.unconfirmed = () => [{ actionId: 'a', action }];
    render(() => <AgentComposer />);

    expect(screen.getByTestId('unconfirmed').textContent).toContain(
      'Run the tests'
    );
    expect(mocks.issue).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Send anyway' }).click();

    expect(mocks.dropUnconfirmed).toHaveBeenCalledWith('a');
    await vi.waitFor(() =>
      expect(mocks.issue).toHaveBeenCalledWith(action, {
        onChecking: expect.any(Function),
      })
    );
  });

  it('shows the checking notice only on the session being checked', async () => {
    const [session, setSession] = createSignal('session-1');
    mocks.sessionId = session;
    mocks.issue.mockImplementation(
      (_action: unknown, options: { onChecking?: () => void }) =>
        new Promise(() => {
          options.onChecking?.();
        })
    );
    render(() => <AgentComposer />);
    sendFromInput('Run the tests');

    expect(
      await screen.findByText('Checking whether it was sent…')
    ).toBeTruthy();
    setSession('session-2');
    expect(screen.queryByText('Checking whether it was sent…')).toBeNull();
  });

  it('leaves the composer empty once the message is taken', async () => {
    mocks.issue.mockResolvedValue(ok({ status: 'accepted', actionId: 'a' }));
    render(() => <AgentComposer />);
    sendFromInput('Run the tests', [attachment]);

    await vi.waitFor(() => expect(mocks.issue).toHaveBeenCalled());
    await Promise.resolve();
    expect(mocks.input?.draft).toBe('');
    expect(mocks.input?.attachments).toEqual([]);
  });
});
