/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewDecision, ReviewItem } from '../core/review';
import { ReviewStack } from './review-stack';

const editor = vi.hoisted(() => ({
  ready: true,
  valid: true,
  submitReady: undefined as Promise<void> | undefined,
  executed: undefined as Promise<boolean> | undefined,
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mobile.value }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: (props: {
    initialData: { subject: string; body: string };
    registerDraftReader: (read: () => unknown) => void;
    registerSubmitReader: (read: () => Promise<unknown>) => void;
    sink: {
      canAct: () => boolean;
      onExecute: (draft: unknown) => Promise<boolean>;
    };
  }) => {
    const [body, setBody] = createSignal(props.initialData.body);
    const read = () => ({ ...props.initialData, body: body() });
    props.registerDraftReader(() => (editor.ready ? read() : undefined));
    props.registerSubmitReader(async () => {
      await editor.submitReady;
      return editor.valid ? read() : undefined;
    });
    return (
      <div>
        <label>
          {props.initialData.subject}
          <textarea
            aria-label="Draft body"
            value={body()}
            disabled={!props.sink.canAct()}
            onInput={(event) => setBody(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={!props.sink.canAct()}
          onClick={() => {
            editor.executed = props.sink.onExecute(read());
          }}
        >
          Send draft
        </button>
      </div>
    );
  },
}));
vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: (props: {
    initialData: { title: string };
    registerDraftReader: (read: () => unknown) => void;
    registerSubmitReader: (read: () => Promise<unknown>) => void;
  }) => {
    props.registerDraftReader(() => props.initialData);
    props.registerSubmitReader(async () => props.initialData);
    return <p>{props.initialData.title}</p>;
  },
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  editor.ready = true;
  editor.valid = true;
  editor.submitReady = undefined;
  editor.executed = undefined;
  mobile.value = false;
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function setup(
  options: {
    canAct?: boolean;
    presentedAt?: number | null;
    items?: ReviewItem[];
    kind?: Review['kind'];
    failSave?: boolean;
    failedItem?: string;
  } = {}
) {
  let record: Review = {
    id: 'review',
    sessionId: 'session',
    executionId: 'execution',
    kind: options.kind ?? 'email',
    title: 'Drafts to review',
    revision: 0,
    updatedAt: 0,
    presentedAt: options.presentedAt === undefined ? 1 : options.presentedAt,
    items: options.items ?? [
      {
        id: 'first',
        status: 'pending',
        draft: {
          subject: 'First email',
          body: 'Hello',
          to: [{ email: 'first@example.com' }],
        },
      },
      {
        id: 'second',
        status: 'pending',
        draft: {
          subject: 'Second email',
          body: 'World',
          to: [{ email: 'second@example.com' }],
        },
      },
    ],
  };
  const decide = vi.fn(async (decision: ReviewDecision) => {
    if (
      decision.revision !== record.revision ||
      (options.failSave && decision.action === 'edit')
    )
      throw new Error('conflict');
    record = {
      ...record,
      revision: record.revision + 1,
      items: record.items.map((item) => {
        if (decision.action === 'edit')
          return item.id === decision.item
            ? { ...item, draft: decision.draft }
            : item;
        if (
          item.status !== 'pending' ||
          (decision.items.length > 0 && !decision.items.includes(item.id))
        )
          return item;
        if (decision.action === 'submit' && item.id === options.failedItem) {
          return { ...item, error: 'The destination rejected this draft.' };
        }
        return {
          ...item,
          status: decision.action === 'submit' ? 'completed' : 'dismissed',
        };
      }),
    };
    return record;
  });
  render(() => (
    <ReviewStack
      review={record}
      canAct={options.canAct ?? true}
      actions={{ decide, reload: async () => record }}
    />
  ));
  return decide;
}

async function confirmBatch(
  label = 'Send all (2)',
  confirmation = 'Send 2 emails'
) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('button', { name: confirmation }));
}

describe('review deck', () => {
  it.each([false, true])(
    'requires confirmation and lets the user cancel with mobile=%s',
    async (isMobile) => {
      mobile.value = isMobile;
      const decide = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Send all (2)' }));
      expect(
        await screen.findByRole('button', { name: 'Send 2 emails' })
      ).toBeTruthy();
      expect(decide).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Send 2 emails' })
        ).toBeNull()
      );
      expect(decide).not.toHaveBeenCalled();
      expect(screen.getByText('First email')).toBeTruthy();
    }
  );
  it('shows a single draft in its composer without navigation or batch actions', () => {
    setup({
      items: [
        {
          id: 'one',
          status: 'pending',
          draft: {
            subject: 'One email',
            body: 'Hello',
            to: [{ email: 'one@example.com' }],
          },
        },
      ],
    });
    expect(screen.getByLabelText('Draft body')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Drafts to review' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Send all/ })).toBeNull();
  });
  it('waits for presentation acknowledgment before editing or sending', () => {
    const decide = setup({ presentedAt: null });
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Draft body').disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Send all (2)' })
        .disabled
    ).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });
  it('captures the editor before navigation and restores its saved edit', async () => {
    const decide = setup();
    fireEvent.input(screen.getByLabelText('Draft body'), {
      target: { value: 'Edited first' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next draft' }));
    await screen.findByText('Second email');
    expect(decide.mock.calls[0][0]).toMatchObject({
      action: 'edit',
      item: 'first',
      draft: { body: 'Edited first' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous draft' }));
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Draft body').value
      ).toBe('Edited first')
    );
  });
  it('keeps edits visible when navigation cannot save them', async () => {
    const decide = setup({ failSave: true });
    fireEvent.input(screen.getByLabelText('Draft body'), {
      target: { value: 'Unsaved edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next draft' }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(screen.getByLabelText<HTMLTextAreaElement>('Draft body').value).toBe(
      'Unsaved edit'
    );
    expect(screen.queryByText('Second email')).toBeNull();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('keeps the current draft while attachments or editor content are unavailable', () => {
    const decide = setup();
    editor.ready = false;
    fireEvent.click(screen.getByRole('button', { name: 'Next draft' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('First email')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });
  it('saves the latest editor value before sending the stack', async () => {
    const decide = setup();
    fireEvent.input(screen.getByLabelText('Draft body'), {
      target: { value: 'Latest edit' },
    });
    await confirmBatch();
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls.map(([decision]) => decision.action)).toEqual([
      'edit',
      'submit',
    ]);
    expect(decide.mock.calls[1][0]).toEqual({
      action: 'submit',
      revision: 1,
      items: ['first', 'second'],
    });
    expect(await screen.findByText('2 sent')).toBeTruthy();
  });
  it('locks navigation and editing while preparing the batch', async () => {
    let finish!: () => void;
    editor.submitReady = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const decide = setup();
    await confirmBatch();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Next draft' })
        .disabled
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Draft body').disabled
    ).toBe(true);
    expect(decide).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
  });
  it('opens the failed draft after a partially successful batch', async () => {
    setup({ failedItem: 'second' });
    await confirmBatch();
    await screen.findByText('Second email');
    expect(screen.getByRole('alert').textContent).toBe(
      'The destination rejected this draft.'
    );
    expect(screen.getByRole('button', { name: 'Send all (1)' })).toBeTruthy();
    expect(screen.getByText(/1 sent · 1 needs attention/)).toBeTruthy();
  });
  it('opens an uncertain draft once when a locally submitted batch finishes through polling', async () => {
    let server: Review = {
      id: 'review',
      sessionId: 'session',
      kind: 'email',
      title: 'Polled drafts',
      revision: 0,
      updatedAt: 0,
      presentedAt: 1,
      items: [
        {
          id: 'first',
          status: 'pending',
          draft: {
            subject: 'First email',
            body: 'Hello',
            to: [{ email: 'first@example.com' }],
          },
        },
        {
          id: 'second',
          status: 'pending',
          draft: {
            subject: 'Second email',
            body: 'World',
            to: [{ email: 'second@example.com' }],
          },
        },
      ],
    };
    const [review, setReview] = createSignal(server);
    const decide = vi.fn(async () => {
      server = {
        ...server,
        revision: 1,
        items: server.items.map((item) => ({ ...item, status: 'submitting' })),
      };
      return server;
    });
    render(() => (
      <ReviewStack
        review={review()}
        canAct
        actions={{ decide, reload: async () => server }}
      />
    ));
    await confirmBatch();
    await screen.findByText('Sending…');
    expect(screen.getByText('First email')).toBeTruthy();
    expect(screen.queryByText('Second email')).toBeNull();

    server = {
      ...server,
      revision: 2,
      items: server.items.map((item) => ({
        ...item,
        status: item.id === 'first' ? 'submitting' : 'unknown',
      })),
    };
    setReview(server);
    expect(screen.getByText('First email')).toBeTruthy();
    expect(screen.queryByText('Second email')).toBeNull();

    server = {
      ...server,
      revision: 3,
      items: server.items.map((item) => ({
        ...item,
        status: item.id === 'first' ? 'completed' : 'unknown',
      })),
    };
    setReview(server);
    await screen.findByText('Second email');
    expect(
      screen.getByText(
        'Outcome unknown — check the destination before trying again.'
      )
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Polled drafts' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous draft' }));
    await screen.findByText('First email');
    setReview({ ...server, revision: 4, updatedAt: 10 });
    expect(screen.getByText('First email')).toBeTruthy();
    expect(screen.queryByText('Second email')).toBeNull();
    expect(decide).toHaveBeenCalledOnce();
  });
  it('does not change the selected card for outcomes from a batch started elsewhere', async () => {
    const initial: Review = {
      id: 'review',
      sessionId: 'session',
      kind: 'email',
      title: 'Polled drafts',
      revision: 0,
      updatedAt: 0,
      presentedAt: 1,
      items: [
        {
          id: 'first',
          status: 'submitting',
          draft: {
            subject: 'First email',
            body: 'Hello',
            to: [{ email: 'first@example.com' }],
          },
        },
        {
          id: 'second',
          status: 'submitting',
          draft: {
            subject: 'Second email',
            body: 'World',
            to: [{ email: 'second@example.com' }],
          },
        },
      ],
    };
    const [review, setReview] = createSignal(initial);
    const decide = vi.fn(async () => review());
    render(() => (
      <ReviewStack
        review={review()}
        canAct
        actions={{ decide, reload: async () => review() }}
      />
    ));
    setReview({
      ...initial,
      revision: 1,
      items: initial.items.map((item) => ({
        ...item,
        status: item.id === 'first' ? 'completed' : 'unknown',
      })),
    });
    await screen.findByText('Sent');
    expect(screen.getByText('First email')).toBeTruthy();
    expect(screen.queryByText('Second email')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });
  it('opens an invalid unvisited draft without dispatching any email', async () => {
    const decide = setup({
      items: [
        {
          id: 'first',
          status: 'pending',
          draft: {
            subject: 'Ready email',
            body: 'Ready',
            to: [{ email: 'one@example.com' }],
          },
        },
        {
          id: 'second',
          status: 'pending',
          draft: { subject: 'Needs a recipient', body: 'Hello', to: [] },
        },
      ],
    });
    await confirmBatch();
    await screen.findByText('Needs a recipient');
    expect(screen.getByRole('alert').textContent).toBe(
      'Add at least one recipient.'
    );
    expect(decide).not.toHaveBeenCalled();
  });
  it('keeps an unprepared draft editable without a generic instruction banner', async () => {
    const decide = setup();
    editor.valid = false;
    await confirmBatch();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Send all (2)' })
          .disabled
      ).toBe(false)
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Draft body').disabled
    ).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });
  it('keeps non-owner controls disabled while allowing read-only navigation', async () => {
    const decide = setup({ canAct: false });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Send all (2)' })
        .disabled
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Draft body').disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next draft' }));
    await screen.findByText('Second email');
    expect(decide).not.toHaveBeenCalled();
  });
  it('advances after sending one draft and retains the batch history', async () => {
    const decide = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await screen.findByText('Second email');
    expect(decide.mock.calls[0][0]).toMatchObject({
      action: 'submit',
      items: ['first'],
    });
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Drafts to review' })
    );
    expect(screen.getByRole('button', { name: 'Send all (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous draft' }));
    await screen.findByText('First email');
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Draft body').disabled
    ).toBe(true);
    await editor.executed;
  });
  it.each([false, true])(
    'searches and selects a draft with mobile=%s',
    async (isMobile) => {
      mobile.value = isMobile;
      setup({
        items: Array.from({ length: 12 }, (_, index) => ({
          id: `draft-${index}`,
          status: 'pending',
          draft: {
            subject: `Email ${index + 1}`,
            body: `Body ${index + 1}`,
            to: [{ email: `person${index + 1}@example.com` }],
          },
        })),
      });
      const picker = screen.getByRole('button', {
        name: 'Choose draft, 1 of 12',
      });
      picker.focus();
      fireEvent.click(picker);
      const dialog = await screen.findByRole('dialog', {
        name: 'Drafts to review',
      });
      fireEvent.input(within(dialog).getByLabelText('Search drafts'), {
        target: { value: 'person12' },
      });
      expect(within(dialog).queryByText('Email 2')).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: /Email 12/ }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Draft body').value
      ).toBe('Body 12');
      expect(screen.getAllByLabelText('Draft body')).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: 'Choose draft, 12 of 12' })
      ).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(picker));
    }
  );
  it('creates every remaining calendar event with the same batch control', async () => {
    const decide = setup({
      kind: 'calendar',
      items: [
        {
          id: 'first',
          status: 'pending',
          draft: {
            title: 'First event',
            time: {
              kind: 'timed',
              startsAt: '2026-10-16T09:00:00Z',
              endsAt: '2026-10-16T10:00:00Z',
              timeZone: 'UTC',
            },
          },
        },
        {
          id: 'second',
          status: 'pending',
          draft: {
            title: 'Second event',
            time: {
              kind: 'allDay',
              startDate: '2026-10-17',
              endDate: '2026-10-18',
            },
          },
        },
      ],
    });
    await confirmBatch('Create all (2)', 'Create 2 events');
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide.mock.calls[0][0]).toEqual({
      action: 'submit',
      revision: 0,
      items: ['first', 'second'],
    });
    expect(await screen.findByText('2 created')).toBeTruthy();
  });
});
