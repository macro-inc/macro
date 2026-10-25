import {
  $createClassedBlockNode,
  $isClassedBlockNode,
  $isDocumentMentionNode,
} from '@macro-inc/lexical-core';
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENTS_BYTES_SIZE } from '../core/constants';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { createEmailEditor } from '../tests/editor';
import { mountReplyComposer } from '../tests/reply';
import {
  appendAttachmentLinks,
  createAttachmentLinkOffer,
} from './attachment-links';

const disposers: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

const report = {
  documentId: 'doc-1',
  name: 'Quarterly report',
  blockName: 'pdf',
};
const huge = new File(
  [new ArrayBuffer(MAX_ATTACHMENTS_BYTES_SIZE + 1)],
  'huge.mov'
);
const small = new File(['notes'], 'notes.txt');

/** One entry per top-level block: the written text, a link's document, or the quoted thread. */
function outline(editor: LexicalEditor): string[] {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => {
        if ($isClassedBlockNode(node)) return 'quote';
        const mention = $isElementNode(node)
          ? node.getChildren().find((child) => $isDocumentMentionNode(child))
          : undefined;
        return mention
          ? `link:${mention.getDocumentId()}`
          : `text:${node.getTextContent()}`;
      })
  );
}

function appendQuotedThread(editor: LexicalEditor) {
  editor.update(
    () =>
      $getRoot().append(
        $createClassedBlockNode({
          tag: 'div',
          classes: ['macro_quote', 'gmail_quote'],
        })
      ),
    { discrete: true }
  );
}

describe('appendAttachmentLinks', () => {
  it('links each document after the written text, above the quoted thread', () => {
    const editor = createEmailEditor('Please review');
    appendQuotedThread(editor);
    appendAttachmentLinks(editor, [
      report,
      { documentId: 'doc-2', name: 'Recording', blockName: 'video' },
    ]);
    expect(outline(editor)).toEqual([
      'text:Please review',
      'link:doc-1',
      'link:doc-2',
      'quote',
    ]);
  });

  it('links at the end of a message without a quoted thread', () => {
    const editor = createEmailEditor('Please review');
    appendAttachmentLinks(editor, [report]);
    expect(outline(editor)).toEqual(['text:Please review', 'link:doc-1']);
  });
});

describe('createAttachmentLinkOffer', () => {
  function offerFor(
    editor: LexicalEditor,
    confirmed: boolean,
    canEdit = () => true,
    version = () => ''
  ) {
    const confirm = vi.fn(async () => confirmed);
    const uploadDocuments = vi.fn(async () => [report]);
    const makePublic = vi.fn();
    const links = createRoot((dispose) => {
      disposers.push(dispose);
      return {
        ...createAttachmentLinkOffer({
          editor: () => editor,
          canEdit,
          version,
          notices: { confirm },
          editorFiles: { uploadDocuments, makePublic },
        }),
        dispose,
      };
    });
    return { ...links, confirm, uploadDocuments, makePublic };
  }

  it('uploads nothing when the user declines', async () => {
    const editor = createEmailEditor('Hi');
    const { share, confirm, uploadDocuments } = offerFor(editor, false);
    await share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Attachments exceed 18 MB',
      body: '"huge.mov" won\'t fit as an attachment. Upload it to Macro and share a view-only link instead?',
      confirmLabel: 'Share link',
    });
    expect(uploadDocuments).not.toHaveBeenCalled();
    expect(outline(editor)).toEqual(['text:Hi']);
  });

  it('uploads, opens, and links each confirmed file', async () => {
    const editor = createEmailEditor('Hi');
    const { share, confirm, uploadDocuments, makePublic } = offerFor(
      editor,
      true
    );
    await share([huge, small], MAX_ATTACHMENTS_BYTES_SIZE);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "2 files won't fit as attachments. Upload them to Macro and share view-only links instead?",
        confirmLabel: 'Share links',
      })
    );
    expect(uploadDocuments).toHaveBeenCalledExactlyOnceWith([huge, small]);
    expect(makePublic).toHaveBeenCalledExactlyOnceWith('doc-1');
    expect(outline(editor)).toEqual(['text:Hi', 'link:doc-1']);
  });

  it('asks nothing when every file fits', async () => {
    const editor = createEmailEditor('Hi');
    const { share, confirm } = offerFor(editor, true);
    await share([], MAX_ATTACHMENTS_BYTES_SIZE);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reports the upload in flight until it settles', async () => {
    const editor = createEmailEditor('Hi');
    const pending = Promise.withResolvers<(typeof report)[]>();
    const links = offerFor(editor, true);
    links.uploadDocuments.mockReturnValue(pending.promise);
    const sharing = links.share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
    await vi.advanceTimersByTimeAsync(0);
    expect(links.uploading()).toBe(true);
    pending.resolve([report]);
    await sharing;
    expect(links.uploading()).toBe(false);
    expect(outline(editor)).toEqual(['text:Hi', 'link:doc-1']);
  });

  it('uploads nothing when the composer moved on while the prompt was open', async () => {
    const editor = createEmailEditor('Hi');
    const decision = Promise.withResolvers<boolean>();
    const links = offerFor(editor, true);
    links.confirm.mockReturnValue(decision.promise);
    const sharing = links.share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
    links.detach();
    decision.resolve(true);
    await sharing;
    expect(links.uploadDocuments).not.toHaveBeenCalled();
    expect(outline(editor)).toEqual(['text:Hi']);
  });

  it('invalidates a pending confirmation when a queued lock arrives and clears', async () => {
    const editor = createEmailEditor('Frozen');
    const [canEdit, setCanEdit] = createSignal(true);
    const decision = Promise.withResolvers<boolean>();
    const links = offerFor(editor, true, canEdit);
    links.confirm.mockReturnValue(decision.promise);
    const sharing = links.share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
    setCanEdit(false);
    setCanEdit(true);
    decision.resolve(true);
    await sharing;
    expect(links.uploadDocuments).not.toHaveBeenCalled();
    expect(outline(editor)).toEqual(['text:Frozen']);
  });

  it.each(['lock', 'identity', 'dispose', 'readonly'] as const)(
    'keeps late uploads private and unlinked after %s',
    async (change) => {
      const editor = createEmailEditor('Frozen');
      const [canEdit, setCanEdit] = createSignal(true);
      const [version, setVersion] = createSignal('original');
      const started = Promise.withResolvers<void>();
      const pending = Promise.withResolvers<(typeof report)[]>();
      const links = offerFor(editor, true, canEdit, version);
      links.uploadDocuments.mockImplementation(() => {
        started.resolve();
        return pending.promise;
      });
      const sharing = links.share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
      await started.promise;
      if (change === 'lock') setCanEdit(false);
      if (change === 'identity') setVersion('restored');
      if (change === 'dispose') links.dispose();
      if (change === 'readonly') editor.setEditable(false);
      pending.resolve([report]);
      await sharing;
      expect(links.makePublic).not.toHaveBeenCalled();
      expect(outline(editor)).toEqual(['text:Frozen']);
      expect(links.uploading()).toBe(false);
    }
  );

  it('keeps a file private and unlinked when the composer moved on mid-upload', async () => {
    const editor = createEmailEditor('Hi');
    const pending = Promise.withResolvers<(typeof report)[]>();
    const links = offerFor(editor, true);
    links.uploadDocuments.mockReturnValue(pending.promise);
    const sharing = links.share([huge], MAX_ATTACHMENTS_BYTES_SIZE);
    await vi.advanceTimersByTimeAsync(0);
    links.detach();
    pending.resolve([report]);
    await sharing;
    expect(links.makePublic).not.toHaveBeenCalled();
    expect(outline(editor)).toEqual(['text:Hi']);
  });
});

describe('oversized attachments in the composers', () => {
  it('attaches what fits in a new email and offers the rest as links', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    try {
      root.edit('With files');
      await root.state.context.onAddAttachments([small, huge]);
      expect(root.state.context.attachments()).toEqual([
        { type: 'local', file: small },
      ]);
      expect(context.notices.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ confirmLabel: 'Share link' })
      );
      expect(context.editorFiles.uploadDocuments).not.toHaveBeenCalled();
      expect(outline(root.editor)).toEqual(['text:With files']);
    } finally {
      root.dispose();
    }
  });

  it('refuses to send a new email while a shared file is still uploading', async () => {
    const context = createComposeContext();
    const pending = Promise.withResolvers<(typeof report)[]>();
    vi.mocked(context.notices.confirm).mockResolvedValue(true);
    vi.mocked(context.editorFiles.uploadDocuments).mockReturnValue(
      pending.promise
    );
    const root = mountEmailComposer(context);
    try {
      root.edit('Sent too early');
      const adding = root.state.context.onAddAttachments([huge]);
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.primaryActionDisabled()).toBe(true);
      expect(root.state.context.sendUnavailableReason?.()).toBe(
        'Uploading files to share…'
      );
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Failed to send email',
        { subtext: 'Files are still uploading' }
      );
      pending.resolve([report]);
      await adding;
      expect(root.state.context.primaryActionDisabled()).toBe(false);
      expect(outline(root.editor)).toEqual([
        'text:Sent too early',
        'link:doc-1',
      ]);
    } finally {
      root.dispose();
    }
  });

  it('drops a link that lands after the reply was discarded', async () => {
    const context = createComposeContext();
    const pending = Promise.withResolvers<(typeof report)[]>();
    vi.mocked(context.notices.confirm).mockResolvedValue(true);
    vi.mocked(context.editorFiles.uploadDocuments).mockReturnValue(
      pending.promise
    );
    const composer = mountReplyComposer(context);
    try {
      const adding = composer.handleAddAttachments([huge]);
      await vi.advanceTimersByTimeAsync(0);
      expect(composer.sendActionDisabled()).toBe(true);
      await composer.deleteDraftAndReset();
      pending.resolve([report]);
      await adding;
      expect(context.editorFiles.makePublic).not.toHaveBeenCalled();
      expect(outline(composer.editor)).toEqual(['text:']);
    } finally {
      composer.dispose();
    }
  });

  it('links a confirmed file above the quoted thread of a reply without attaching it', async () => {
    const context = createComposeContext();
    vi.mocked(context.notices.confirm).mockResolvedValue(true);
    vi.mocked(context.editorFiles.uploadDocuments).mockResolvedValue([report]);
    const composer = mountReplyComposer(context);
    try {
      appendQuotedThread(composer.editor);
      await composer.handleAddAttachments([huge]);
      expect(
        context.editorFiles.uploadDocuments
      ).toHaveBeenCalledExactlyOnceWith([huge]);
      expect(context.editorFiles.makePublic).toHaveBeenCalledExactlyOnceWith(
        'doc-1'
      );
      expect(composer.form.attachments.list()).toEqual([]);
      expect(outline(composer.editor)).toEqual([
        'text:Ready to send',
        'link:doc-1',
        'quote',
      ]);
    } finally {
      composer.dispose();
    }
  });
});
