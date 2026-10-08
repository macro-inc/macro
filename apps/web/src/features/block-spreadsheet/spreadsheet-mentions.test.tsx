import {
  cellTextParts,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/DocumentMention',
  () => ({ DocumentMention: () => 'document mention' })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/UserMention',
  () => ({ UserMention: () => 'user mention' })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu',
  () => ({ MentionsMenu: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils',
  () => ({ getBlockNameFromEntity: () => 'md' })
);
vi.mock(
  '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin',
  () => ({ parseMacroAppUrl: () => ({ isValid: false }) })
);
vi.mock('./spreadsheet-cell-links', () => ({
  SpreadsheetCellLinks: (props: { value: string }) => props.value,
}));

import { linkMentions, spreadsheetMentions } from './spreadsheet-mentions';

afterEach(cleanup);

it('turns a routine link into a rendered mention chip instead of exposing its encoding', () => {
  const value = linkMentions(
    'https://macro.com/app/routines/routine-1',
    () => ({
      block: 'routine',
      id: 'routine-1',
      params: {},
    })
  );
  expect(cellTextParts(value)[0].mention).toMatchObject({
    type: 'document',
    blockName: 'routine',
    documentId: 'routine-1',
  });
  render(() => spreadsheetMentions.renderText(value));
  expect(
    document.querySelector('[data-spreadsheet-mention]')?.textContent
  ).toBe('document mention');
  expect(document.body.textContent).not.toContain('<m-document-mention>');
});

it('renders a date pill as a relative chip with the full date as its tooltip', () => {
  const tomorrow = new Date();
  tomorrow.setHours(9, 30, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const due = encodeCellMention({
    type: 'date',
    date: tomorrow.toISOString(),
    displayFormat: 'Next week',
  });
  render(() => spreadsheetMentions.renderText(`Due ${due}`));
  const chip = screen.getByTitle(/9:30 AM$/);
  expect(chip.textContent).toBe('Tomorrow');
  expect(chip.getAttribute('data-date')).toBe(tomorrow.toISOString());
  expect(document.body.textContent).toBe('Due Tomorrow');
});
