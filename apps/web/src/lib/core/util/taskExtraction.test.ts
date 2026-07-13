import { describe, expect, it, vi } from 'vitest';

// Mock the Lexical utils to avoid JSX dependency chain
vi.mock(
  '@core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxParsing',
  async () => {
    const actual = await vi.importActual<
      typeof import('@core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxParsing')
    >(
      '@core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxParsing'
    );
    return {
      extractUserMentions: actual.extractUserMentions,
      extractDateMention: actual.extractDateMention,
      extractTitleFromMarkdown: actual.extractTitleFromMarkdown,
    };
  }
);

vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  $elementNodeToMarkdown: vi.fn(),
}));

import {
  extractCheckboxesFromMarkdown,
  trimEdgeUserMentions,
} from './taskExtraction';

describe('extractCheckboxesFromMarkdown', () => {
  it('should extract single unchecked checkbox', () => {
    const markdown = '- [ ] Buy groceries';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      lineIndex: 0,
      title: 'Buy groceries',
      rawLine: '- [ ] Buy groceries',
      isChecked: false,
      assigneeUserIds: [],
      dueDate: null,
    });
  });

  it('should extract single checked checkbox', () => {
    const markdown = '- [x] Completed task';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: 'Completed task',
      isChecked: true,
    });
  });

  it('should handle uppercase X in checkbox', () => {
    const markdown = '- [X] Task with uppercase X';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].isChecked).toBe(true);
  });

  it('should extract multiple checkboxes', () => {
    const markdown = `- [ ] Task 1
- [x] Task 2
- [ ] Task 3`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      lineIndex: 0,
      title: 'Task 1',
      isChecked: false,
    });
    expect(result[1]).toMatchObject({
      lineIndex: 1,
      title: 'Task 2',
      isChecked: true,
    });
    expect(result[2]).toMatchObject({
      lineIndex: 2,
      title: 'Task 3',
      isChecked: false,
    });
  });

  it('should skip empty checkboxes', () => {
    const markdown = `- [ ] Valid task
- [ ]
- [ ]
- [ ] Another valid task`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Valid task');
    expect(result[1].title).toBe('Another valid task');
  });

  it('should ignore non-checkbox lines', () => {
    const markdown = `Some intro text
- [ ] A checkbox task
Regular bullet point
- Another bullet
- [ ] Second checkbox`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ lineIndex: 1, title: 'A checkbox task' });
    expect(result[1]).toMatchObject({ lineIndex: 4, title: 'Second checkbox' });
  });

  it('should handle indented checkboxes', () => {
    const markdown = `- [ ] Parent task
  - [ ] Nested task
    - [ ] Deeply nested`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Parent task');
    expect(result[1].title).toBe('Nested task');
    expect(result[2].title).toBe('Deeply nested');
  });

  it('should extract user mentions as assignees', () => {
    const markdown =
      '- [ ] Fix bug <m-user-mention>{"userId":"user-123","email":"alice@test.com"}</m-user-mention>';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].assigneeUserIds).toEqual(['user-123']);
    expect(result[0].title).toBe('Fix bug');
  });

  it('should extract multiple user mentions', () => {
    const markdown =
      '- [ ] Review PR <m-user-mention>{"userId":"u1","email":"a@x.com"}</m-user-mention> and <m-user-mention>{"userId":"u2","email":"b@x.com"}</m-user-mention>';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].assigneeUserIds).toEqual(['u1', 'u2']);
  });

  it('should extract date mentions as due date', () => {
    const markdown =
      '- [ ] Submit report <m-date-mention>{"date":"2024-03-15T00:00:00Z","displayFormat":"March 15"}</m-date-mention>';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBeInstanceOf(Date);
    expect(result[0].dueDate?.toISOString()).toBe('2024-03-15T00:00:00.000Z');
    expect(result[0].title).toBe('Submit report');
  });

  it('should extract both user and date mentions', () => {
    const markdown =
      '- [ ] Complete task <m-user-mention>{"userId":"u1","email":"alice@test.com"}</m-user-mention> by <m-date-mention>{"date":"2024-12-31","displayFormat":"Dec 31"}</m-date-mention>';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Complete task by');
    expect(result[0].assigneeUserIds).toEqual(['u1']);
    expect(result[0].dueDate).toBeInstanceOf(Date);
    expect(result[0].dueDate?.toISOString()).toBe('2024-12-31T00:00:00.000Z');
  });

  it('should return empty array for markdown without checkboxes', () => {
    const markdown = `# Heading
Regular paragraph text.
- Bullet point
1. Numbered item`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toEqual([]);
  });

  it('should return empty array for empty markdown', () => {
    expect(extractCheckboxesFromMarkdown('')).toEqual([]);
  });

  it('should handle mixed content with checkboxes', () => {
    const markdown = `# Shopping List

Here are my tasks:

- [ ] Buy milk
- [ ] Get bread

Some notes below.

- [ ] Call mom`;
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ lineIndex: 4, title: 'Buy milk' });
    expect(result[1]).toMatchObject({ lineIndex: 5, title: 'Get bread' });
    expect(result[2]).toMatchObject({ lineIndex: 9, title: 'Call mom' });
  });

  it('should preserve rawLine for replacement', () => {
    const markdown = '  - [ ] Indented with spaces';
    const result = extractCheckboxesFromMarkdown(markdown);

    expect(result).toHaveLength(1);
    expect(result[0].rawLine).toBe('  - [ ] Indented with spaces');
  });
});

describe('trimEdgeUserMentions', () => {
  const aliceMention =
    '<m-user-mention>{"userId":"u1","email":"alice@test.com"}</m-user-mention>';
  const bobMention =
    '<m-user-mention>{"userId":"u2","email":"bob@test.com"}</m-user-mention>';

  it('trims a leading user mention', () => {
    expect(trimEdgeUserMentions(`${aliceMention} fix the search bug`)).toBe(
      'fix the search bug'
    );
  });

  it('trims a trailing user mention', () => {
    expect(trimEdgeUserMentions(`fix the search bug ${aliceMention}`)).toBe(
      'fix the search bug'
    );
  });

  it('trims mentions on both ends', () => {
    expect(
      trimEdgeUserMentions(`${aliceMention} fix the search bug ${bobMention}`)
    ).toBe('fix the search bug');
  });

  it('trims multiple consecutive mentions at edges', () => {
    expect(
      trimEdgeUserMentions(
        `${aliceMention} ${bobMention} fix the search bug ${aliceMention} ${bobMention}`
      )
    ).toBe('fix the search bug');
  });

  it('preserves mentions in the middle', () => {
    const input = `${aliceMention} ping ${bobMention} about the bug`;
    expect(trimEdgeUserMentions(input)).toBe(
      `ping ${bobMention} about the bug`
    );
  });

  it('returns empty string when content is only mentions', () => {
    expect(trimEdgeUserMentions(`${aliceMention} ${bobMention}`)).toBe('');
  });

  it('handles surrounding whitespace', () => {
    expect(
      trimEdgeUserMentions(`  ${aliceMention}   fix the bug   ${bobMention}  `)
    ).toBe('fix the bug');
  });

  it('leaves text without edge mentions unchanged', () => {
    expect(trimEdgeUserMentions('fix the search bug')).toBe(
      'fix the search bug'
    );
  });
});
