import { describe, expect, it } from 'vitest';
import { referenceMenuGroups } from './reference-menu';

describe('referenceMenuGroups', () => {
  it('orders all preview actions into nonempty groups', () => {
    expect(
      referenceMenuGroups({
        host: 'preview',
        openInNewSplit: true,
        askMacro: true,
        copyBranchName: true,
        convertPreview: true,
        convertToText: true,
        collapse: true,
        delete: true,
      })
    ).toEqual([
      { id: 'open', items: ['open-new-split'] },
      { id: 'most-used', items: ['ask-macro'] },
      { id: 'copy', items: ['copy-link', 'copy-branch-name'] },
      { id: 'modify', items: ['convert-preview', 'convert-text'] },
      { id: 'state', items: ['collapse'] },
      { id: 'delete', items: ['delete'] },
    ]);
  });

  it('orders all card actions without adding preview conversions or collapse', () => {
    expect(
      referenceMenuGroups({
        host: 'card',
        openInNewSplit: true,
        askMacro: true,
        copyBranchName: true,
        convertToMention: true,
        delete: true,
      })
    ).toEqual([
      { id: 'open', items: ['open-new-split'] },
      { id: 'most-used', items: ['ask-macro'] },
      { id: 'copy', items: ['copy-link', 'copy-branch-name'] },
      { id: 'modify', items: ['convert-mention'] },
      { id: 'delete', items: ['delete'] },
    ]);
  });

  it('omits unavailable preview actions without empty groups', () => {
    expect(
      referenceMenuGroups({
        host: 'preview',
        openInNewSplit: false,
        askMacro: false,
        copyBranchName: false,
        convertPreview: false,
        convertToText: true,
        collapse: false,
        delete: false,
      })
    ).toEqual([
      { id: 'copy', items: ['copy-link'] },
      { id: 'modify', items: ['convert-text'] },
    ]);
  });

  it('keeps only Copy Link when card navigation and editing are unavailable', () => {
    expect(
      referenceMenuGroups({
        host: 'card',
        openInNewSplit: false,
        askMacro: false,
        copyBranchName: false,
        convertToMention: false,
        delete: false,
      })
    ).toEqual([{ id: 'copy', items: ['copy-link'] }]);
  });
});
