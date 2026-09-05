/**
 * @vitest-environment jsdom
 */

import type { ApiMessage } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { htmlToSnippetText, messageSnippet } from './messageSnippet';

describe('htmlToSnippetText', () => {
  // Previously this flattened with `textContent`, which joins text nodes with
  // no separator, so the preview read "Hey Kyle!First,".
  it('keeps a space where a paragraph break was', () => {
    expect(htmlToSnippetText('<p>Hey Kyle!</p><p>First,</p>')).toBe(
      'Hey Kyle! First,'
    );
  });

  it('keeps a space where a div break was', () => {
    expect(htmlToSnippetText('<div>/smooth!</div><div>And</div>')).toBe(
      '/smooth! And'
    );
  });

  it('keeps a space where a <br> was', () => {
    expect(htmlToSnippetText('line one<br>line two')).toBe('line one line two');
  });

  it('never emits two spaces together', () => {
    const snippet = htmlToSnippetText(
      '<div><p>One</p>\n\n<p>  Two  </p><br><br><p>Three</p></div>'
    );
    expect(snippet).toBe('One Two Three');
    expect(snippet).not.toMatch(/ {2}/);
  });

  it('does not introduce a space inside a line', () => {
    expect(htmlToSnippetText('<p>Hello <b>there</b>, friend</p>')).toBe(
      'Hello there, friend'
    );
  });

  it('does not pad the ends', () => {
    expect(htmlToSnippetText('<p>Only one paragraph</p>')).toBe(
      'Only one paragraph'
    );
  });

  it('separates table cells', () => {
    expect(
      htmlToSnippetText('<table><tr><td>Total</td><td>$5</td></tr></table>')
    ).toBe('Total $5');
  });

  it('is empty for markup with no text', () => {
    expect(htmlToSnippetText('<div><br></div>')).toBe('');
  });
});

describe('messageSnippet', () => {
  const message = (fields: Partial<ApiMessage>): ApiMessage =>
    fields as ApiMessage;

  it('prefers the plain-text body and collapses its newlines', () => {
    expect(
      messageSnippet(message({ body_text: 'Hey Kyle!\nFirst,\n\nsecond' }))
    ).toBe('Hey Kyle! First, second');
  });

  it('falls back to the HTML body', () => {
    expect(
      messageSnippet(
        message({ body_html_sanitized: '<p>Hey Kyle!</p><p>First,</p>' })
      )
    ).toBe('Hey Kyle! First,');
  });

  it('falls back to the HTML body when the text body is empty', () => {
    expect(
      messageSnippet(
        message({
          body_text: '',
          body_html_sanitized: '<p>Hey Kyle!</p><p>First,</p>',
        })
      )
    ).toBe('Hey Kyle! First,');
  });

  it('falls back to the HTML body when the text body is only whitespace', () => {
    expect(
      messageSnippet(
        message({
          body_text: ' \n ',
          body_html_sanitized: '<p>Hey Kyle!</p><p>First,</p>',
        })
      )
    ).toBe('Hey Kyle! First,');
  });

  it('is empty when there is no body', () => {
    expect(messageSnippet(message({}))).toBe('');
  });
});
