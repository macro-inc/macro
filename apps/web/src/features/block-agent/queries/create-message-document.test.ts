import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentFromReply } from './create-message-document';

const createMarkdownFile = vi.hoisted(() => vi.fn());
const replaceCitations = vi.hoisted(() => vi.fn());

vi.mock('@core/util/create', () => ({
  createMarkdownFile,
}));
vi.mock('@core/component/LexicalMarkdown/citationsUtils', () => ({
  replaceCitations,
}));

beforeEach(() => {
  createMarkdownFile.mockReset();
  replaceCitations.mockReset();
});

describe('createDocumentFromReply', () => {
  it('stores the reply with its citations turned into mentions', async () => {
    replaceCitations.mockResolvedValue('Draft mention');
    createMarkdownFile.mockResolvedValue('document-1');

    await expect(
      createDocumentFromReply({
        title: 'Filmmaker and Editor',
        markdown: 'Draft [[md;doc;node]]',
      })
    ).resolves.toBe('document-1');

    expect(createMarkdownFile).toHaveBeenCalledWith({
      content: 'Draft mention',
      title: 'Filmmaker and Editor',
      source: 'agent-message',
    });
  });
});
