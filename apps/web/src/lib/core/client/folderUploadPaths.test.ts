import { describe, expect, it } from 'vitest';
import { groupPickedFolderFiles, joinZipPath } from './folderUploadPaths';

const picked = (webkitRelativePath: string) => ({
  name: webkitRelativePath.split('/').at(-1) ?? webkitRelativePath,
  webkitRelativePath,
});

describe('groupPickedFolderFiles', () => {
  it('keeps the picked folder as the first path segment', () => {
    const groups = groupPickedFolderFiles([
      picked('Board Pack/Summary.docx'),
      picked('Board Pack/Finance/Forecasts/Q4.xlsx'),
      picked('Board Pack/Decks/Archive/Old.pptx'),
    ]);

    expect([...groups.keys()]).toEqual(['Board Pack']);
    expect(groups.get('Board Pack')?.details.map((d) => d.path)).toEqual([
      'Board Pack/Summary.docx',
      'Board Pack/Finance/Forecasts/Q4.xlsx',
      'Board Pack/Decks/Archive/Old.pptx',
    ]);
  });

  it('keeps the picked folder when it only holds one subfolder', () => {
    const groups = groupPickedFolderFiles([
      picked('Wrapper/Inner/a.docx'),
      picked('Wrapper/Inner/Deeper/b.pptx'),
    ]);

    expect(groups.get('Wrapper')?.details.map((d) => d.path)).toEqual([
      'Wrapper/Inner/a.docx',
      'Wrapper/Inner/Deeper/b.pptx',
    ]);
  });

  it('keeps file objects aligned with their paths', () => {
    const files = [picked('A/x.docx'), picked('B/y.xlsx'), picked('A/z.pptx')];
    const groups = groupPickedFolderFiles(files);

    expect(groups.get('A')?.files).toEqual([files[0], files[2]]);
    expect(groups.get('B')?.files).toEqual([files[1]]);
  });

  it('falls back to the file name without a relative path', () => {
    const groups = groupPickedFolderFiles([
      { name: 'loose.docx', webkitRelativePath: '' },
    ]);

    expect(groups.get('loose.docx')?.details).toEqual([{ path: 'loose.docx' }]);
  });
});

describe('joinZipPath', () => {
  it('joins nested paths', () => {
    expect(joinZipPath('', 'Root')).toBe('Root');
    expect(joinZipPath('Root', 'Sub')).toBe('Root/Sub');
    expect(joinZipPath('Root/Sub', 'a.docx')).toBe('Root/Sub/a.docx');
  });
});
