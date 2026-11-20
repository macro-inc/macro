import { aiHeaderTools } from '@app/features/block-ai/views/shared/ai-header-parts';
import { figHeaderTools } from '@app/features/block-fig/views/shared/fig-header-parts';
import { pptxHeaderTools } from '@app/features/block-pptx/views/shared/pptx-header-parts';
import { psdHeaderTools } from '@app/features/block-psd/views/shared/psd-header-parts';
import { spreadsheetHeaderTools } from '@app/features/block-spreadsheet/views/shared/spreadsheet-header-parts';
import { docxHeaderTools } from '@app/features/block-write/views/shared/docx-header-parts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  getShareDrawerRecipientInput: () => undefined,
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentIcon: () => null,
  openChatWithAgent: vi.fn(),
}));

describe('file header action contributions', () => {
  it.each([
    ['fig', figHeaderTools],
    ['psd', psdHeaderTools],
    ['ai', aiHeaderTools],
    ['pptx', pptxHeaderTools],
    ['docx', docxHeaderTools],
  ] as const)(
    'keeps %s sharing and download behavior in their semantic groups',
    async (_kind, build) => {
      const share = vi.fn();
      const download = vi.fn(async () => {});
      const menu = build({
        documentId: 'document',
        name: () => 'Example',
        openShare: share,
        download,
      });
      expect(menu.actions.share.group).toBe('most-used');
      expect(menu.actions.share.action).toBe(share);
      const exportAction = menu.ops.find((op) => !('op' in op));
      if (!exportAction || 'op' in exportAction)
        throw new Error('missing export action');
      expect(exportAction.group).toBe('share-export');
      await exportAction.action?.();
      expect(download).toHaveBeenCalledOnce();
      expect(menu.ops.filter((op) => 'op' in op).map((op) => op.op)).toEqual([
        'rename',
        'copy',
        'moveToProject',
        'delete',
      ]);
    }
  );

  it('keeps spreadsheet format choices inside the export submenu', async () => {
    const download = vi.fn();
    const menu = spreadsheetHeaderTools({
      documentId: 'sheet',
      name: () => 'Example',
      openShare: vi.fn(),
      download,
      chatContext: () => undefined,
    });
    const exportAction = menu.ops.find((op) => !('op' in op));
    if (!exportAction || 'op' in exportAction)
      throw new Error('missing export action');
    expect(exportAction.group).toBe('share-export');
    await exportAction.children?.[0].action?.();
    await exportAction.children?.[1].action?.();
    expect(download.mock.calls).toEqual([['xlsx'], ['csv']]);
    expect(menu.actions.askMacro.group).toBe('most-used');
    expect(menu.actions.share.group).toBe('most-used');
  });
});
