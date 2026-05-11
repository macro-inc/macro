import EnvelopeIcon from '@icon/regular/envelope.svg';
import FilePdfIcon from '@icon/regular/file-pdf.svg';
import FileTextIcon from '@icon/regular/file-text.svg';
import HashIcon from '@icon/regular/hash.svg';
import { describe, expect, it } from 'vitest';
import {
  getSearchIcon,
  getSenderId,
} from '../src/extractors-search/search-helpers';
import type { ContentHitData } from '../src/types/search';

describe('search-helpers', () => {
  describe('getSenderId', () => {
    it('returns senderId for channel type hits', () => {
      const hit: ContentHitData = {
        type: 'channel',
        senderId: 'user123',
      } as ContentHitData;

      expect(getSenderId(hit)).toBe('user123');
    });

    it('returns senderId for email type hits', () => {
      const hit: ContentHitData = {
        type: 'email',
        senderId: 'user456',
      } as ContentHitData;

      expect(getSenderId(hit)).toBe('user456');
    });

    it('returns undefined for md type hits', () => {
      const hit: ContentHitData = {
        type: 'md',
      } as ContentHitData;

      expect(getSenderId(hit)).toBeUndefined();
    });

    it('returns undefined for pdf type hits', () => {
      const hit: ContentHitData = {
        type: 'pdf',
      } as ContentHitData;

      expect(getSenderId(hit)).toBeUndefined();
    });

    it('handles channel hits without senderId', () => {
      const hit: ContentHitData = {
        type: 'channel',
      } as ContentHitData;

      expect(getSenderId(hit)).toBeUndefined();
    });

    it('handles email hits without senderId', () => {
      const hit: ContentHitData = {
        type: 'email',
      } as ContentHitData;

      expect(getSenderId(hit)).toBeUndefined();
    });
  });

  describe('getSearchIcon', () => {
    it('returns FileTextIcon for md type', () => {
      const hit: ContentHitData = {
        type: 'md',
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(FileTextIcon);
    });

    it('returns FilePdfIcon for pdf type', () => {
      const hit: ContentHitData = {
        type: 'pdf',
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(FilePdfIcon);
    });

    it('returns HashIcon for channel type', () => {
      const hit: ContentHitData = {
        type: 'channel',
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(HashIcon);
    });

    it('returns EnvelopeIcon for email type', () => {
      const hit: ContentHitData = {
        type: 'email',
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(EnvelopeIcon);
    });

    it('returns FileTextIcon for unknown types', () => {
      const hit: ContentHitData = {
        type: 'unknown' as any,
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(FileTextIcon);
    });

    it('handles hits with additional properties', () => {
      const hit: ContentHitData = {
        type: 'channel',
        senderId: 'user123',
        content: 'some content',
      } as ContentHitData;

      expect(getSearchIcon(hit)).toBe(HashIcon);
    });
  });
});
