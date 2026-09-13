import { describe, expect, it } from 'vitest';
import { message } from '../tests/messages';
import { messageSnippet } from './message-snippet';

describe('messageSnippet', () => {
  it('strips signature markdown from a Macro-authored collapsed preview', () => {
    expect(
      messageSnippet(
        message('sig', {
          body_macro:
            'Thanks for the note.\n\n*— from [Cam Pak](https://example.com/cam)* *[faith.tools](https://faith.tools) • [dotflowy.com](https://dotflowy.com)*',
          body_text:
            'Thanks for the note.\n\n*— from [Cam Pak](https://example.com/cam)* *[faith.tools](https://faith.tools) • [dotflowy.com](https://dotflowy.com)*',
          body_html_sanitized: '',
        })
      )
    ).toBe('Thanks for the note. — from Cam Pak faith.tools • dotflowy.com');
  });

  it('strips emphasis and bare link labels from the reported signature form', () => {
    expect(
      messageSnippet(
        message('bare', {
          body_macro: '*— from [Cam Pak]* *[faith.tools] • [dotflowy.com]*',
          body_text: '*— from [Cam Pak]* *[faith.tools] • [dotflowy.com]*',
          body_html_sanitized: null,
        })
      )
    ).toBe('— from Cam Pak faith.tools • dotflowy.com');
  });

  it('uses rendered HTML for Macro-authored mail so styled signatures become readable text', () => {
    expect(
      messageSnippet(
        message('html-sig', {
          body_macro:
            'Thanks\n\n*— from [Cam Pak](https://example.com/cam)* *[faith.tools](https://faith.tools) • [dotflowy.com](https://dotflowy.com)*',
          body_text:
            'Thanks\n\n*— from [Cam Pak](https://example.com/cam)* *[faith.tools](https://faith.tools) • [dotflowy.com](https://dotflowy.com)*',
          body_html_sanitized:
            '<p>Thanks</p><p><em>— from <a href="https://example.com/cam">Cam Pak</a></em> <em><a href="https://faith.tools">faith.tools</a> • <a href="https://dotflowy.com">dotflowy.com</a></em></p>',
        })
      )
    ).toBe('Thanks — from Cam Pak faith.tools • dotflowy.com');
  });

  it('inserts a space where HTML block elements met with no whitespace', () => {
    expect(
      messageSnippet(
        message('blocks', {
          body_macro: 'Hey Kyle!\nFirst,',
          body_text: 'Hey Kyle!First,',
          body_html_sanitized: '<p>Hey Kyle!</p><p>First,</p>',
        })
      )
    ).toBe('Hey Kyle! First,');
  });

  it('keeps received-mail plaintext, including asterisks, when there is no body_macro', () => {
    expect(
      messageSnippet(
        message('received', {
          body_macro: null,
          body_text: 'Cost is 2 * 3 * 4, see you\nsoon.',
          body_html_sanitized: '<p>Cost is 2 * 3 * 4, see you</p><p>soon.</p>',
        })
      )
    ).toBe('Cost is 2 * 3 * 4, see you soon.');
  });

  it('falls back to the HTML body when the text body is only whitespace', () => {
    expect(
      messageSnippet(
        message('ws', {
          body_macro: null,
          body_text: ' \n ',
          body_html_sanitized: '<p>Hey Kyle!</p><p>First,</p>',
        })
      )
    ).toBe('Hey Kyle! First,');
  });

  it('is empty when there is no body', () => {
    expect(
      messageSnippet(
        message('empty', {
          body_macro: null,
          body_text: null,
          body_html_sanitized: null,
        })
      )
    ).toBe('');
  });
});
