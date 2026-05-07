import { describe, expect, it, vi } from 'vitest';

// Mock the Lexical utils to avoid JSX dependency chain
vi.mock('../../utils', () => ({
  $elementNodeToMarkdown: vi.fn(),
}));

import {
  extractDateMention,
  extractTitleFromMarkdown,
  extractUserMentions,
} from './checkboxParsing';

describe('Checkbox Parsing', () => {
  describe('extractUserMentions', () => {
    it('should extract single user mention', () => {
      const text =
        'Fix bug <m-user-mention>{"userId":"user-123","email":"alice@example.com"}</m-user-mention>';
      expect(extractUserMentions(text)).toEqual(['user-123']);
    });

    it('should extract multiple user mentions', () => {
      const text =
        '<m-user-mention>{"userId":"u1","email":"a@x.com"}</m-user-mention> and <m-user-mention>{"userId":"u2","email":"b@x.com"}</m-user-mention>';
      expect(extractUserMentions(text)).toEqual(['u1', 'u2']);
    });

    it('should return empty array when no mentions', () => {
      expect(extractUserMentions('Just plain text')).toEqual([]);
    });

    it('should handle malformed JSON gracefully', () => {
      const text = '<m-user-mention>{invalid json}</m-user-mention>';
      expect(extractUserMentions(text)).toEqual([]);
    });

    it('should handle missing userId field', () => {
      const text =
        '<m-user-mention>{"email":"alice@example.com"}</m-user-mention>';
      expect(extractUserMentions(text)).toEqual([]);
    });
  });

  describe('extractDateMention', () => {
    it('should extract date from mention', () => {
      const text =
        'Due <m-date-mention>{"date":"2024-03-15T00:00:00Z","displayFormat":"March 15, 2024"}</m-date-mention>';
      const result = extractDateMention(text);
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2024-03-15T00:00:00.000Z');
    });

    it('should return null when no date mention', () => {
      expect(extractDateMention('No date here')).toBeNull();
    });

    it('should return null when date is not a string', () => {
      const text =
        '<m-date-mention>{"date":2024-03-15T00:00:00Z,"displayFormat":"March 15, 2024"}</m-date-mention>';
      const result = extractDateMention(text);
      expect(result).toBeNull();
    });

    it('should return null when date is not a valid date', () => {
      const text =
        '<m-date-mention>{"date":"2024-16-15T00:00:00Z","displayFormat":"March 15, 2024"}</m-date-mention>';
      const result = extractDateMention(text);
      console.log('result 4', result);
      expect(result).toBeNull();
    });

    it('should return first date when multiple present', () => {
      const text =
        '<m-date-mention>{"date":"2024-01-01","displayFormat":"Jan 1"}</m-date-mention> to <m-date-mention>{"date":"2024-12-31","displayFormat":"Dec 31"}</m-date-mention>';
      const result = extractDateMention(text);
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should handle malformed JSON gracefully', () => {
      const text = '<m-date-mention>{invalid}</m-date-mention>';
      expect(extractDateMention(text)).toBeNull();
    });

    it('should handle null date field', () => {
      const text =
        '<m-date-mention>{"date":null,"displayFormat":"N/A"}</m-date-mention>';
      expect(extractDateMention(text)).toBeNull();
    });

    it('should handle missing date field', () => {
      const text =
        '<m-date-mention>{"displayFormat":"March 15"}</m-date-mention>';
      expect(extractDateMention(text)).toBeNull();
    });
  });

  describe('extractTitleFromMarkdown', () => {
    it('should remove user mentions (they become assignees)', () => {
      const text =
        'Review by <m-user-mention>{"userId":"u1","email":"alice@test.com"}</m-user-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('Review by');
    });

    it('should remove date mentions (they become due date)', () => {
      const text =
        'Due <m-date-mention>{"date":"2024-03-15","displayFormat":"March 15"}</m-date-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('Due');
    });

    it('should remove both user and date mentions', () => {
      const text =
        '<m-user-mention>{"userId":"u1","email":"bob@x.com"}</m-user-mention>: finish by <m-date-mention>{"date":"2024-01-01","displayFormat":"Jan 1"}</m-date-mention>';
      expect(extractTitleFromMarkdown(text)).toBe(': finish by');
    });

    it('should produce clean title with task description', () => {
      const text =
        'Fix the login bug <m-user-mention>{"userId":"u1","email":"alice@test.com"}</m-user-mention> <m-date-mention>{"date":"2024-03-15","displayFormat":"March 15"}</m-date-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('Fix the login bug');
    });

    it('should clean up extra whitespace', () => {
      const text = '  Too   many   spaces  ';
      expect(extractTitleFromMarkdown(text)).toBe('Too many spaces');
    });

    it('should remove checkbox prefix', () => {
      const text = '- [ ] This is a todo item';
      expect(extractTitleFromMarkdown(text)).toBe('This is a todo item');
    });

    it('should remove checked checkbox prefix', () => {
      const text = '- [x] Completed item';
      expect(extractTitleFromMarkdown(text)).toBe('Completed item');
    });

    it('should handle document mentions', () => {
      const text =
        'See <m-document-mention>{"documentId":"doc-123","documentName":"My Doc","blockName":"md"}</m-document-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('See My Doc');
    });

    it('should handle contact mentions', () => {
      const text =
        'Contact <m-contact-mention>{"contactId":"c-1","name":"John Doe","emailOrDomain":"john@co.com","isCompany":false}</m-contact-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('Contact John Doe');
    });

    it('should handle group mentions', () => {
      const text =
        'Notify <m-group-mention>{"groupAlias":"here"}</m-group-mention>';
      expect(extractTitleFromMarkdown(text)).toBe('Notify @here');
    });

    it('should return empty string for empty checkbox', () => {
      const text = '- [ ] ';
      expect(extractTitleFromMarkdown(text)).toBe('');
    });
  });
});
