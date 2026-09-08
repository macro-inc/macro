import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { composeEnvironment } from '../tests/capabilities';
import { createEmailComposer } from './email-composer';

// Real controller and editor, with only feature capabilities replaced.
describe('standalone compose controller', () => {
  afterEach(() => vi.useRealTimers());
  it('saves a composed draft after debounce and preserves the recipients and HTML', async () => {
    vi.useFakeTimers();
    const services = composeEnvironment();
    const showDraft = vi.fn();
    const root = createRoot((dispose) => ({
      dispose,
      state: createEmailComposer({
        ...services,
        host: { showDraft },
        initialTo: ['colleague@example.com'],
      }),
    }));
    try {
      const editor = createEditor({
        nodes: SupportedNodeTypes,
        namespace: 'email-controller-test',
        onError: (error) => {
          throw error;
        },
      });
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode('Keep this draft'))
          );
        },
        { discrete: true }
      );
      root.state.context.captureEditor(editor);
      root.state.context.setSubject('Architecture');
      root.state.context.onContentChange('Keep this draft');
      await vi.advanceTimersByTimeAsync(600);
      expect(services.drafts.saveDraft).toHaveBeenCalled();
      const input = vi.mocked(services.drafts.saveDraft).mock.calls.at(-1)![0];
      expect(input.draft.to).toEqual([
        expect.objectContaining({ email: 'colleague@example.com' }),
      ]);
      expect(input.draft.subject).toBe('Architecture');
      expect(decodeBase64Utf8(input.draft.body_html ?? '')).toContain(
        'Keep this draft'
      );
      expect(root.state.context.hasDraft()).toBe(true);
    } finally {
      root.dispose();
    }
  });
  it('does not send an empty draft', async () => {
    const services = composeEnvironment();
    const root = createRoot((dispose) => ({
      dispose,
      state: createEmailComposer({ ...services }),
    }));
    try {
      root.state.context.onSend();
      await Promise.resolve();
      expect(services.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  });
});

it('reports scheduling failure without adopting an unconfirmed send time, and keeps a confirmed schedule when archive fails', async () => {
  vi.useFakeTimers();
  const services = composeEnvironment();
  const root = createRoot((dispose) => ({
    dispose,
    state: createEmailComposer({
      ...services,
      initialTo: ['colleague@example.com'],
    }),
  }));
  try {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Schedule this reply'))
        );
      },
      { discrete: true }
    );
    root.state.context.captureEditor(editor);
    root.state.context.setSubject('Schedule review');
    root.state.context.onContentChange('Schedule this reply');
    const requested = new Date('2026-10-01T12:00:00Z');
    vi.mocked(services.delivery.schedule).mockRejectedValueOnce(
      new Error('offline')
    );
    await root.state.context.onSendTimeChange?.(requested);
    expect(root.state.context.sendTime()).toBeFalsy();
    expect(services.notices.feedback.failure).toHaveBeenCalledWith(
      'Failed to schedule message'
    );
    vi.mocked(services.delivery.archive).mockRejectedValueOnce(
      new Error('archive offline')
    );
    await root.state.context.onSendTimeChange?.(requested);
    expect(root.state.context.sendTime()).toEqual(requested);
    expect(services.notices.feedback.failure).toHaveBeenCalledWith(
      'Email scheduled, but unable to mark thread done'
    );
  } finally {
    root.dispose();
    vi.useRealTimers();
  }
});

it('blocks immediate send and overlapping changes while a scheduling request is pending', async () => {
  let finish!: () => void;
  const services = composeEnvironment({
    delivery: {
      schedule: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      ),
    },
  });
  const root = createRoot((dispose) => ({
    dispose,
    state: createEmailComposer({
      ...services,
      initialTo: ['colleague@example.com'],
    }),
  }));
  try {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Schedule this reply'))
        );
      },
      { discrete: true }
    );
    root.state.context.captureEditor(editor);
    root.state.context.setSubject('Schedule review');
    root.state.context.onContentChange('Schedule this reply');
    const request = root.state.context.onSendTimeChange?.(
      new Date('2026-10-01T12:00:00Z')
    );
    await vi.waitFor(() =>
      expect(services.delivery.schedule).toHaveBeenCalledOnce()
    );
    expect(root.state.context.disabled()).toBe(true);
    root.state.context.onSend();
    await root.state.context.onSendTimeChange?.(
      new Date('2026-10-02T12:00:00Z')
    );
    expect(services.delivery.sendMessage).not.toHaveBeenCalled();
    expect(services.delivery.schedule).toHaveBeenCalledOnce();
    finish();
    await request;
    expect(root.state.context.disabled()).toBe(false);
    expect(root.state.draftDirty()).toBe(true);
  } finally {
    root.dispose();
  }
});
