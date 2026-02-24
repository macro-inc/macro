import { describe, expect, it, vi } from 'vitest';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
  removeInboxQueryFilters,
  removeOtherQueryFilters,
} from './inbox-query-filters';

vi.mock('./filters', () => ({
  EXCLUDE: ['00000000-0000-0000-0000-000000000000'],
}));

describe('inbox-query-filters', () => {
  describe('applyInboxQueryFilters', () => {
    it('applies inbox notification filters, task bypass, and email importance', () => {
      const result = applyInboxQueryFilters({});

      expect(result.channel_filters?.notification_filters?.done).toBe(false);
      expect(result.chat_filters?.notification_filters?.done).toBe(false);
      expect(result.project_filters?.notification_filters?.done).toBe(false);
      expect(result.document_filters?.notification_filters?.done).toBe(false);
      expect(result.document_filters?.task_filters?.include_cbm_atm_nc).toBe(
        true
      );
      expect(result.email_filters?.importance).toBe(true);
    });
  });

  describe('removeInboxQueryFilters', () => {
    it('strips inbox-applied filters from an inbox-applied payload', () => {
      const applied = applyInboxQueryFilters({});
      const result = removeInboxQueryFilters(applied);

      expect(result.channel_filters).toBeUndefined();
      expect(result.chat_filters).toBeUndefined();
      expect(result.project_filters).toBeUndefined();
      expect(result.document_filters).toBeUndefined();
      expect(result.email_filters).toBeUndefined();
    });

    it('strips include_cbm_atm_nc while preserving other task filters', () => {
      const result = removeInboxQueryFilters({
        document_filters: {
          task_filters: {
            include_cbm_atm_nc: true,
          },
        },
      });

      expect(result.document_filters?.task_filters).toEqual({
        status: ['todo'],
      });
      expect(
        result.document_filters?.task_filters?.include_cbm_atm_nc
      ).toBeUndefined();
    });

    it('keeps non-inbox notification values intact', () => {
      const result = removeInboxQueryFilters({
        channel_filters: {
          notification_filters: {
            done: true,
          },
        },
      });

      expect(result.channel_filters?.notification_filters?.done).toBe(true);
    });
  });

  describe('applyOtherQueryFilters', () => {
    it('applies other filters and email importance=false', () => {
      const result = applyOtherQueryFilters({
        email_filters: {
          recipients: [],
        },
      });

      expect(result.channel_filters?.channel_ids).toBeDefined();
      expect(result.chat_filters?.chat_ids).toBeDefined();
      expect(result.project_filters?.project_ids).toBeDefined();
      expect(result.document_filters?.document_ids).toBeDefined();
      expect(result.email_filters?.importance).toBe(false);
      expect(result.email_filters?.recipients).toEqual([]);
    });
  });

  describe('removeOtherQueryFilters', () => {
    it('strips other-applied ids and importance=false while preserving unrelated fields', () => {
      const applied = applyOtherQueryFilters({
        channel_filters: { channel_types: ['direct_message'] as any },
        email_filters: { recipients: [] },
      });

      const result = removeOtherQueryFilters(applied);

      expect(result.channel_filters).toEqual({
        channel_types: ['direct_message'],
      });
      expect(result.chat_filters).toBeUndefined();
      expect(result.project_filters).toBeUndefined();
      expect(result.document_filters).toBeUndefined();
      expect(result.email_filters).toEqual({ recipients: [] });
    });
  });
});
