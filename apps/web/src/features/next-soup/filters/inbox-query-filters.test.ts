import { describe, expect, it } from 'vitest';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
  removeInboxQueryFilters,
  removeOtherQueryFilters,
} from './inbox-query-filters';

describe('inbox-query-filters', () => {
  describe('applyInboxQueryFilters', () => {
    it('applies inbox notification filters and email importance', () => {
      const result = applyInboxQueryFilters({});

      expect(result.channel_filters?.notification_filters?.states).toEqual([
        'unseen',
        'seen',
      ]);
      expect(result.chat_filters?.notification_filters?.states).toEqual([
        'unseen',
        'seen',
      ]);
      expect(result.project_filters?.notification_filters?.states).toEqual([
        'unseen',
        'seen',
      ]);
      expect(result.document_filters?.notification_filters?.states).toEqual([
        'unseen',
        'seen',
      ]);
      expect(result.email_filters?.importance).toBe(true);
    });
  });

  it('retains exact active subsets and never broadens a done-only selection to all states', () => {
    expect(
      applyInboxQueryFilters({
        document_filters: { notification_filters: { states: ['unseen'] } },
      }).document_filters?.notification_filters?.states
    ).toEqual(['unseen']);
    expect(
      applyInboxQueryFilters({
        document_filters: { notification_filters: { states: ['seen'] } },
      }).document_filters?.notification_filters?.states
    ).toEqual(['seen']);
    expect(
      applyInboxQueryFilters({
        document_filters: { notification_filters: { states: ['done'] } },
      }).document_filters?.notification_filters?.states
    ).toEqual(['unseen', 'seen']);
    expect(
      applyInboxQueryFilters({
        document_filters: { notification_filters: { states: [] } },
      }).document_filters?.notification_filters?.states
    ).toEqual(['unseen', 'seen']);
  });

  it('intersects mixed notification selections with active states without losing read intent', () => {
    for (const states of [
      ['seen', 'done'],
      ['unseen', 'done'],
      ['done', 'seen', 'unseen', 'seen'],
    ] as const) {
      const input = {
        document_filters: { notification_filters: { states: [...states] } },
        chat_filters: { notification_filters: { states: [...states] } },
        channel_filters: { notification_filters: { states: [...states] } },
        project_filters: { notification_filters: { states: [...states] } },
      };
      const result = applyInboxQueryFilters(input);
      expect(input.channel_filters.notification_filters.states).toEqual(states);
      const expected = (['unseen', 'seen'] as const).filter((state) =>
        states.some((selected) => selected === state)
      );
      for (const filter of [
        result.document_filters,
        result.chat_filters,
        result.channel_filters,
        result.project_filters,
      ]) {
        expect(filter?.notification_filters?.states).toEqual(expected);
      }
    }
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

    it('keeps non-inbox notification values intact', () => {
      const result = removeInboxQueryFilters({
        channel_filters: {
          notification_filters: {
            states: ['done'],
          },
        },
      });

      expect(result.channel_filters?.notification_filters?.states).toEqual([
        'done',
      ]);
    });
  });

  describe('applyOtherQueryFilters', () => {
    it('applies importance=false to all filter types', () => {
      const result = applyOtherQueryFilters({
        email_filters: {
          recipients: [],
        },
      });

      expect(result.channel_filters?.importance).toBe(false);
      expect(result.chat_filters?.importance).toBe(false);
      expect(result.project_filters?.importance).toBe(false);
      expect(result.document_filters?.importance).toBe(false);
      expect(result.email_filters?.importance).toBe(false);
      expect(result.email_filters?.recipients).toEqual([]);
    });
  });

  describe('removeOtherQueryFilters', () => {
    it('strips importance=false while preserving unrelated fields', () => {
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
