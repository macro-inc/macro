import { describe, expect, it } from 'vitest';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';
import { parseDateMentions } from '../utils/parsers';

function importFirstChild(markdown: string) {
  const state = markdownToSerializedEditorStateWithIds(markdown);
  return state.root.children[0];
}

describe('date mention import', () => {
  it('imports a whole-day chip with a bare local date', () => {
    expect(
      importFirstChild(
        '<m-date-mention>{"date":"2026-11-13","displayFormat":"Fri, Nov 13"}</m-date-mention>'
      )
    ).toMatchObject({
      children: [
        {
          type: 'date-mention',
          date: '2026-11-13',
          displayFormat: 'Fri, Nov 13',
        },
      ],
    });
  });

  it('imports a moment chip with a UTC offset', () => {
    expect(
      importFirstChild(
        '<m-date-mention>{"date":"2026-11-13T15:00:00-05:00","displayFormat":"3:00 PM"}</m-date-mention>'
      )
    ).toMatchObject({
      children: [
        {
          type: 'date-mention',
          date: '2026-11-13T15:00:00-05:00',
          displayFormat: '3:00 PM',
        },
      ],
    });
  });

  it('imports a moment chip in UTC', () => {
    expect(
      importFirstChild(
        '<m-date-mention>{"date":"2026-11-13T20:00:00.000Z","displayFormat":"Fri, Nov 13"}</m-date-mention>'
      )
    ).toMatchObject({
      children: [
        {
          type: 'date-mention',
          date: '2026-11-13T20:00:00.000Z',
          displayFormat: 'Fri, Nov 13',
        },
      ],
    });
  });

  it('imports a chip whose body is a bare date', () => {
    // An agent reply rendered "Unknown Date" with `SyntaxError: Unexpected
    // non-whitespace character after JSON at position 4`: the model wrote the
    // date itself as the tag body instead of the JSON object.
    expect(
      importFirstChild('on <m-date-mention>2026-11-13</m-date-mention>')
    ).toMatchObject({
      children: [
        { type: 'text', text: 'on ' },
        {
          type: 'date-mention',
          date: '2026-11-13',
          displayFormat: 'Nov 13, 2026',
        },
      ],
    });
  });

  it('imports a chip whose body is a bare timestamp', () => {
    expect(
      importFirstChild(
        '<m-date-mention>2026-11-13T15:00:00-05:00</m-date-mention>'
      )
    ).toMatchObject({
      children: [
        {
          type: 'date-mention',
          date: '2026-11-13T15:00:00-05:00',
          displayFormat: 'Nov 13, 2026, 3:00 PM',
        },
      ],
    });
  });

  it('shows Unknown Date for a body that is no date', () => {
    expect(
      importFirstChild('<m-date-mention>next Friday</m-date-mention>')
    ).toMatchObject({
      children: [{ type: 'unknown-mention', name: 'Unknown Date' }],
    });
  });

  it('shows Unknown Date for an impossible calendar date', () => {
    expect(
      importFirstChild('<m-date-mention>2026-02-30</m-date-mention>')
    ).toMatchObject({
      children: [{ type: 'unknown-mention', name: 'Unknown Date' }],
    });
  });
});

describe('parseDateMentions with a bare date body', () => {
  it('reads a bare date as its label', () => {
    expect(
      parseDateMentions('due <m-date-mention>2026-11-13</m-date-mention>')
    ).toBe('due Nov 13, 2026');
  });
});
