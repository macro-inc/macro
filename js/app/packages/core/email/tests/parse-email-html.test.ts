import { describe, expect, it } from 'vitest';
import { parseEmailContent, trimTrailingBrs } from '../parse-email-html';

describe('trimTrailingBrs', () => {
  it('removes trailing br elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello</p><br><br><br>';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('<p>Hello</p>');
  });

  it('removes trailing empty text nodes and br elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello</p><br>   <br>';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('<p>Hello</p>');
  });

  it('preserves trailing img elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello</p><br><img src="test.jpg">';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('<p>Hello</p><br><img src="test.jpg">');
  });

  it('preserves meaningful text content', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello</p><br>World';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('<p>Hello</p><br>World');
  });

  it('removes nested trailing br elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello</p><div><br><br></div>';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('<p>Hello</p>');
  });

  it('handles empty element', () => {
    const div = document.createElement('div');
    div.innerHTML = '';
    trimTrailingBrs(div);
    expect(div.innerHTML).toBe('');
  });
});

describe('parseEmailContent', () => {
  it('parses simple HTML content', () => {
    const html = '<p>Hello World</p>';
    const result = parseEmailContent(html);
    expect(result.mainContent).toBe('<p>Hello World</p>');
    expect(result.signature).toBeNull();
    expect(result.hasTable).toBe(false);
  });

  it('detects tables in content', () => {
    const html = '<table><tr><td>Cell</td></tr></table>';
    const result = parseEmailContent(html);
    expect(result.hasTable).toBe(true);
  });

  it('extracts Gmail signature', () => {
    const html = `
      <p>Hello</p>
      <div class="gmail_signature_prefix">--</div>
      <div class="gmail_signature">John Doe</div>
    `;
    const result = parseEmailContent(html, true, false);
    expect(result.mainContent).not.toContain('gmail_signature');
    expect(result.signature).toContain('John Doe');
  });

  it('preserves signature when removeSignature is false', () => {
    const html = `
      <p>Hello</p>
      <div class="gmail_signature_prefix">--</div>
      <div class="gmail_signature">John Doe</div>
    `;
    const result = parseEmailContent(html, false, false);
    expect(result.mainContent).toContain('gmail_signature');
    expect(result.signature).toBeNull();
  });

  it('preserves style tags from head', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>.highlight { color: red; }</style>
        </head>
        <body>
          <p class="highlight">Hello</p>
        </body>
      </html>
    `;
    const result = parseEmailContent(html);
    expect(result.mainContent).toContain('<style>');
    expect(result.mainContent).toContain('.highlight { color: red; }');
  });

  it('removes trailing br elements when removeTrailingBrs is true', () => {
    const html = '<p>Hello</p><br><br>';
    const result = parseEmailContent(html, true, true);
    expect(result.mainContent).not.toMatch(/<br>$/);
  });

  it('preserves trailing br elements when removeTrailingBrs is false', () => {
    const html = '<p>Hello</p><br><br>';
    const result = parseEmailContent(html, true, false);
    expect(result.mainContent).toContain('<br>');
  });

  it('handles malformed HTML gracefully', () => {
    const html = '<p>Unclosed paragraph<div>Nested div</p></div>';
    const result = parseEmailContent(html);
    // Browser DOM parser will fix the malformed HTML
    expect(result.mainContent).toBeTruthy();
  });

  it('handles empty HTML', () => {
    const html = '';
    const result = parseEmailContent(html);
    expect(result.mainContent).toBe('');
    expect(result.hasTable).toBe(false);
  });

  it('handles HTML with only whitespace', () => {
    const html = '   \n\t  ';
    const result = parseEmailContent(html);
    expect(result.hasTable).toBe(false);
  });
});
