import { buildMentionMarkdownString } from '@macro-inc/lexical-core/utils/mentions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHomeAgentPrompt } from './home-agent-prompt';

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (item: { type: string; fileType?: string }) =>
    item.fileType ?? item.type,
}));
vi.mock('@queries/preview', () => ({
  getItemPreview: mocks.preview,
  isAccessiblePreviewItem: (item: { access?: string }) =>
    item?.access === 'access',
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockImplementation(async ({ id, type }) => ({
    id,
    type,
    name: 'Attached item',
    access: 'access',
    ...(type === 'document' ? { fileType: 'pdf' } : {}),
  }));
});

it('preserves prompts with existing mentions without another lookup or duplicate chip', async () => {
  const content = `Read ${buildMentionMarkdownString({ type: 'document', blockParams: {}, documentId: 'doc', documentName: 'Plan', blockName: 'md' })}`;
  expect(
    await buildHomeAgentPrompt({
      content,
      attachments: [{ entity_id: 'doc', entity_type: 'document' }],
    })
  ).toBe(content);
  expect(mocks.preview).not.toHaveBeenCalled();
});

it('adds context chips for attachment-only submissions and preserves file types', async () => {
  const prompt = await buildHomeAgentPrompt({
    content: '',
    attachments: [
      { entity_id: 'doc', entity_type: 'document' },
      { entity_id: 'project', entity_type: 'project' },
      { entity_id: 'thread', entity_type: 'email_thread' },
    ],
  });
  expect(prompt).toBe(
    [
      buildMentionMarkdownString({
        type: 'document',
        blockParams: {},
        documentId: 'doc',
        documentName: 'Attached item',
        blockName: 'pdf',
      }),
      buildMentionMarkdownString({
        type: 'document',
        blockParams: {},
        documentId: 'project',
        documentName: 'Attached item',
        blockName: 'project',
      }),
      buildMentionMarkdownString({
        type: 'document',
        blockParams: {},
        documentId: 'thread',
        documentName: 'Attached item',
        blockName: 'email',
      }),
    ].join('\n\n')
  );
});

describe('attachment failures', () => {
  it('does not silently drop image uploads', async () => {
    await expect(
      buildHomeAgentPrompt({
        content: 'Describe this',
        attachments: [{ entity_id: 'image', entity_type: 'static_file' }],
      })
    ).rejects.toThrow('Image attachments');
  });
  it('rejects unavailable context', async () => {
    mocks.preview.mockResolvedValue({ access: 'no_access' });
    await expect(
      buildHomeAgentPrompt({
        content: 'Read this',
        attachments: [{ entity_id: 'doc', entity_type: 'document' }],
      })
    ).rejects.toThrow('Could not load an attachment');
  });
});
