import type { Attachment, Attachments } from '@core/component/AI/types';

type HomeComposerInput = {
  attachments: Pick<Attachments, 'setAttached'>;
  setPendingDraft: (text: string | null) => void;
};

type HomeComposerEditor = {
  setMarkdown: (markdown: string) => void;
};

export function replaceHomeComposerSelection(
  input: HomeComposerInput,
  draft: string,
  attachments: Attachment[] = []
) {
  input.attachments.setAttached(attachments);
  input.setPendingDraft(draft);
}

export function replaceHomeComposerDraft(
  editor: HomeComposerEditor,
  draft: string
) {
  editor.setMarkdown(draft);
}
