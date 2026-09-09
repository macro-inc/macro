import { describe, expect, it } from 'vitest';
import { plainTextToHtml } from './plain-text-to-html';

function body(text: string) {
  return new DOMParser().parseFromString(plainTextToHtml(text), 'text/html')
    .body;
}

describe('plaintext imported into the editor', () => {
  it.each([
    { input: '', breaks: 1, text: '' },
    { input: 'line1\nline2', breaks: 1, text: 'line1line2' },
    { input: 'above\n\nbelow', breaks: 3, text: 'abovebelow' },
    { input: '\n\n', breaks: 5, text: '' },
  ])(
    'preserves the existing line spacing for $input',
    ({ input, breaks, text }) => {
      const result = body(input);
      expect(result.querySelectorAll('br')).toHaveLength(breaks);
      expect(result.textContent).toBe(text);
    }
  );

  it('renders HTML-looking content and ampersands as literal text', () => {
    const input = '<script>alert("xss")</script> & <img src=x>';
    const result = body(input);
    expect(result.textContent).toBe(input);
    expect(result.querySelector('script, img')).toBeNull();
  });

  it('preserves Markdown punctuation and whitespace without introducing formatting', () => {
    const input = '**Key Points:**  file_name gmail.settings_basic 3 * 5 = 15';
    const result = body(input);
    expect(result.textContent).toBe(input);
    expect(result.querySelector('strong, em, code')).toBeNull();
    expect(result.querySelector('[style]')?.getAttribute('style')).toContain(
      'white-space: pre-wrap'
    );
  });
});
