import { describe, expect, it } from 'vitest';
import {
  markdownToPlainText,
  parseContactMentions,
  parseDateMentions,
  parseDocumentMentions,
  parseLinks,
  parseUserMentions,
} from '../utils/parsers';

describe('parseUserMentions', () => {
  it('extracts email from user mention', () => {
    const input =
      '<m-user-mention>{"email":"john@example.com"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('john@example.com');
  });

  it('returns empty string for missing email', () => {
    const input = '<m-user-mention>{"name":"John"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-user-mention>invalid</m-user-mention>';
    expect(parseUserMentions(input)).toBe('');
  });

  it('handles multiple mentions', () => {
    const input =
      'Hello <m-user-mention>{"email":"a@b.com"}</m-user-mention> and <m-user-mention>{"email":"c@d.com"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('Hello a@b.com and c@d.com');
  });

  it('passes through text without mentions', () => {
    const input = 'Hello world';
    expect(parseUserMentions(input)).toBe('Hello world');
  });
});

describe('parseContactMentions', () => {
  it('extracts name from contact mention', () => {
    const input = '<m-contact-mention>{"name":"Jane Doe"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('Jane Doe');
  });

  it('falls back to emailOrDomain when name is missing', () => {
    const input =
      '<m-contact-mention>{"emailOrDomain":"jane@example.com"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('jane@example.com');
  });

  it('prefers name over emailOrDomain', () => {
    const input =
      '<m-contact-mention>{"name":"Jane","emailOrDomain":"jane@example.com"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('Jane');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-contact-mention>not-json</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('');
  });
});

describe('parseDateMentions', () => {
  it('extracts displayFormat from date mention', () => {
    const input =
      '<m-date-mention>{"displayFormat":"Tomorrow"}</m-date-mention>';
    expect(parseDateMentions(input)).toBe('Tomorrow');
  });

  it('returns empty string for missing displayFormat', () => {
    const input = '<m-date-mention>{"date":"2024-01-01"}</m-date-mention>';
    expect(parseDateMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-date-mention>{broken</m-date-mention>';
    expect(parseDateMentions(input)).toBe('');
  });
});

describe('parseDocumentMentions', () => {
  it('extracts documentName from document mention', () => {
    const input =
      '<m-document-mention>{"documentName":"My Doc"}</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('My Doc');
  });

  it('returns empty string for missing documentName', () => {
    const input = '<m-document-mention>{"id":"123"}</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-document-mention>???</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('');
  });
});

describe('parseLinks', () => {
  it('extracts text from link', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example"}</m-link>';
    expect(parseLinks(input)).toBe('Example');
  });

  it('falls back to url when text is missing', () => {
    const input = '<m-link>{"url":"https://example.com"}</m-link>';
    expect(parseLinks(input)).toBe('https://example.com');
  });

  it('prefers text over url', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Click here"}</m-link>';
    expect(parseLinks(input)).toBe('Click here');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-link>broken</m-link>';
    expect(parseLinks(input)).toBe('');
  });

  it('handles link with title', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example","title":"A title"}</m-link>';
    expect(parseLinks(input)).toBe('Example');
  });
});

describe('markdownToPlainText', () => {
  it('converts mixed content to plain text', () => {
    const input =
      'Hello <m-user-mention>{"email":"john@example.com"}</m-user-mention>, ' +
      'please review <m-document-mention>{"documentName":"Report"}</m-document-mention> ' +
      'by <m-date-mention>{"displayFormat":"Friday"}</m-date-mention>.';
    expect(markdownToPlainText(input)).toBe(
      'Hello john@example.com, please review Report by Friday.'
    );
  });

  it('handles text with links', () => {
    const input =
      'Check out <m-link>{"url":"https://example.com","text":"this link"}</m-link> for more info.';
    expect(markdownToPlainText(input)).toBe(
      'Check out this link for more info.'
    );
  });

  it('returns original text when no mentions present', () => {
    const input = 'Just plain text here.';
    expect(markdownToPlainText(input)).toBe('Just plain text here.');
  });

  it('handles empty string', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});
