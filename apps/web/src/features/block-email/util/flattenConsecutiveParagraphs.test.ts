// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { flattenConsecutiveParagraphs } from './flattenConsecutiveParagraphs';

function flatten(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  flattenConsecutiveParagraphs(body);
  return body.innerHTML;
}

describe('flattenConsecutiveParagraphs', () => {
  it('joins consecutive paragraphs with a blank line', () => {
    expect(flatten('<p>one</p><p>two</p>')).toBe('<div>one<br><br>two</div>');
  });

  it('keeps a lone paragraph as a div without separators', () => {
    expect(flatten('<p>only</p>')).toBe('<div>only</div>');
  });

  it('preserves an explicit blank line (empty paragraph) between paragraphs', () => {
    // Lexical exports an empty paragraph as <p><br></p>
    expect(flatten('<p>one</p><p><br></p><p>two</p>')).toBe(
      '<div>one<br><br><br>two</div>'
    );
  });

  it('does not add a separator after an empty paragraph', () => {
    expect(flatten('<p><br></p><p>two</p>')).toBe('<div><br>two</div>');
  });

  it('flattens non-adjacent runs into separate divs', () => {
    expect(flatten('<p>one</p><ul><li>x</li></ul><p>two</p>')).toBe(
      '<div>one</div><ul><li>x</li></ul><div>two</div>'
    );
  });

  it('treats media-only paragraphs as non-empty', () => {
    expect(flatten('<p><img src="a.png"></p><p>two</p>')).toBe(
      '<div><img src="a.png"><br><br>two</div>'
    );
  });

  it('preserves inline markup within paragraphs', () => {
    expect(flatten('<p><b>one</b></p><p><i>two</i></p>')).toBe(
      '<div><b>one</b><br><br><i>two</i></div>'
    );
  });
});
