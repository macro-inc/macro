import { $getRoot } from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftRestoration } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';
import { createEmailComposer } from './email-composer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const bodies = [
  ['plain text', null, 'Restored body', 'Restored body'],
  [
    'HTML',
    btoa('<p>Restored <strong>HTML</strong></p>'),
    null,
    'Restored HTML',
  ],
  ['empty', null, '', ''],
] as const;

function restoration(
  reply: boolean,
  bodyHtml: string | null,
  bodyText: string | null
) {
  const context = createComposeContext();
  let listener: ((change: EmailDraftRestoration) => void) | undefined;
  context.drafts.watchRestorations = (changed) => {
    listener = changed;
    return () => {};
  };
  context.drafts.readDraft = vi.fn(async () => ({
    draft: message('draft', {
      is_draft: true,
      subject: 'Restored subject',
      body_text: bodyText,
      body_html_sanitized: bodyHtml,
      replying_to_id: reply ? 'parent' : undefined,
    }),
    persistence: 'queued' as const,
  }));
  return {
    context,
    emit: () =>
      listener?.({
        draftId: 'draft',
        originalDraftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        replyingToId: reply ? 'parent' : undefined,
      }),
  };
}

it.each(bodies)(
  'retains restored %s as the standalone editor seed before capture',
  async (_, html, text, expected) => {
    const { context, emit } = restoration(false, html, text);
    const root = createRoot((dispose) => ({
      dispose,
      state: createEmailComposer({
        ...context,
        draft: message('draft', {
          is_draft: true,
          body_text: 'Original sent body',
          body_html_sanitized: null,
        }),
      }),
    }));
    try {
      emit();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.subject()).toBe('Restored subject');
      const element = document.createElement('div');
      element.innerHTML = root.state.context.initialHtml() ?? '';
      expect(element.textContent).toBe(expected);
    } finally {
      root.dispose();
    }
  }
);

it.each(bodies)(
  'keeps restored %s when the reply editor connects afterward',
  async (_, html, text, expected) => {
    const { context, emit } = restoration(true, html, text);
    const root = mountReplyComposer(context, undefined, {
      draft: message('draft', { is_draft: true }),
      preloadedHtml: '<p>Original sent body</p>',
    });
    try {
      emit();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.editor.read(() => $getRoot().getTextContent()).trim()).toBe(
        expected
      );
      root.handleEditorConnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.editor.read(() => $getRoot().getTextContent()).trim()).toBe(
        expected
      );
    } finally {
      root.dispose();
    }
  }
);

it('rejects delayed attachment callbacks until reply restoration finishes', async () => {
  const { context, emit } = restoration(true, null, 'Restored body');
  const read =
    Promise.withResolvers<
      Awaited<ReturnType<NonNullable<typeof context.drafts.readDraft>>>
    >();
  context.drafts.readDraft = vi.fn(() => read.promise);
  const root = mountReplyComposer(context, undefined, {
    draft: message('draft', { is_draft: true }),
  });
  const attachment = {
    type: 'remote' as const,
    attachmentId: 'existing',
    fileName: 'existing.txt',
    contentType: 'text/plain',
    fileSize: 5,
    url: '',
  };
  const file = new File(['audit'], 'new.txt');
  try {
    root.form.attachments.replace([attachment]);
    emit();
    expect(root.editingDisabled()).toBe(true);
    await root.handleAddAttachments([file]);
    await root.handleRemoveAttachment(attachment);
    expect(root.form.attachments.list()).toEqual([attachment]);
    expect(context.attachmentStorage.removeAttachment).not.toHaveBeenCalled();
    expect(context.drafts.saveDraft).not.toHaveBeenCalled();
    read.resolve({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: 'parent',
        body_html_sanitized: null,
        body_text: 'Restored body',
      }),
      persistence: 'queued',
      attachments: [attachment],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.editingDisabled()).toBe(false);
    expect(root.form.attachments.list()).toEqual([attachment]);
    await root.handleAddAttachments([file]);
    expect(root.form.attachments.list()).toHaveLength(2);
  } finally {
    root.dispose();
  }
});

it('clears the standalone initialization seed after discarding a restored draft', async () => {
  const { context, emit } = restoration(false, null, 'Restored body');
  const root = mountEmailComposer(context, undefined, {
    draft: message('draft', {
      is_draft: true,
      body_text: 'Original sent body',
      body_html_sanitized: null,
    }),
  });
  try {
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
      'Restored body'
    );
    expect(await root.state.deleteDraftAndReset()).toBe(true);
    const element = document.createElement('div');
    element.innerHTML = root.state.context.initialHtml() ?? '';
    expect(element.textContent).toBe('');
  } finally {
    root.dispose();
  }
});

it('does not revive either reply seed after discarding and then connecting', async () => {
  const { context, emit } = restoration(true, null, 'Restored body');
  const root = mountReplyComposer(context, undefined, {
    draft: message('draft', { is_draft: true }),
    preloadedHtml: '<p>Original sent body</p>',
  });
  try {
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
      'Restored body'
    );
    await root.deleteDraftAndReset();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.editor.read(() => $getRoot().getTextContent())).toBe('');
    root.handleEditorConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.editor.read(() => $getRoot().getTextContent())).toBe('');
  } finally {
    root.dispose();
  }
});
