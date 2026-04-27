import { describe, expect, it } from 'vitest';
import { buildEntityData } from '../src/utils/buildEntityData';

const base = { id: 'id-1', name: 'Hello', ownerId: 'user-1' };

describe('buildEntityData', () => {
  describe('required base fields', () => {
    it('returns undefined when id is missing', () => {
      expect(
        buildEntityData({ ...base, id: '', blockName: 'md' })
      ).toBeUndefined();
    });

    it('returns undefined when name is missing', () => {
      expect(
        buildEntityData({ ...base, name: '', blockName: 'md' })
      ).toBeUndefined();
    });

    it('defaults ownerId to empty string when omitted', () => {
      const e = buildEntityData({ id: 'a', name: 'b', blockName: 'md' });
      expect(e?.ownerId).toBe('');
    });
  });

  describe('document variants', () => {
    it('builds an md document', () => {
      expect(buildEntityData({ ...base, blockName: 'md' })).toEqual({
        ...base,
        type: 'document',
        fileType: 'md',
        projectId: undefined,
      });
    });

    it('passes projectId through', () => {
      const e = buildEntityData({
        ...base,
        blockName: 'md',
        projectId: 'p-1',
      });
      expect(e).toMatchObject({ type: 'document', projectId: 'p-1' });
    });

    it('uses blockName as fileType for typed documents', () => {
      const e = buildEntityData({ ...base, blockName: 'pdf' });
      expect(e).toMatchObject({ type: 'document', fileType: 'pdf' });
    });

    it('lets explicit fileType override the blockName', () => {
      const e = buildEntityData({
        ...base,
        blockName: 'code',
        fileType: 'py',
      });
      expect(e).toMatchObject({ type: 'document', fileType: 'py' });
    });
  });

  describe('task', () => {
    it('builds a task with subType filled in', () => {
      expect(buildEntityData({ ...base, blockName: 'task' })).toEqual({
        ...base,
        type: 'document',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
        projectId: undefined,
      });
    });

    it('respects isCompleted', () => {
      const e = buildEntityData({
        ...base,
        blockName: 'task',
        isCompleted: true,
      });
      expect(e).toMatchObject({
        subType: { type: 'task', is_completed: true },
      });
    });
  });

  describe('chat / project', () => {
    it('builds a chat', () => {
      expect(buildEntityData({ ...base, blockName: 'chat' })).toEqual({
        ...base,
        type: 'chat',
        projectId: undefined,
      });
    });

    it('builds a project', () => {
      expect(buildEntityData({ ...base, blockName: 'project' })).toEqual({
        ...base,
        type: 'project',
        projectId: undefined,
      });
    });
  });

  describe('channel', () => {
    it('returns undefined without channelType', () => {
      expect(
        buildEntityData({ ...base, blockName: 'channel' })
      ).toBeUndefined();
    });

    it('builds a channel when channelType is provided', () => {
      const e = buildEntityData({
        ...base,
        blockName: 'channel',
        channelType: 'team',
      });
      expect(e).toEqual({ ...base, type: 'channel', channelType: 'team' });
    });
  });

  describe('email', () => {
    it('defaults flags', () => {
      expect(buildEntityData({ ...base, blockName: 'email' })).toEqual({
        ...base,
        type: 'email',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      });
    });

    it('respects provided flags', () => {
      const e = buildEntityData({
        ...base,
        blockName: 'email',
        isRead: false,
        isDraft: true,
        isImportant: true,
        done: true,
      });
      expect(e).toMatchObject({
        isRead: false,
        isDraft: true,
        isImportant: true,
        done: true,
      });
    });
  });

  describe('automation', () => {
    it('returns undefined without cron', () => {
      expect(
        buildEntityData({ ...base, blockName: 'automation' })
      ).toBeUndefined();
    });

    it('builds an automation with cron', () => {
      expect(
        buildEntityData({
          ...base,
          blockName: 'automation',
          cron: '* * * * *',
          enabled: true,
        })
      ).toEqual({
        ...base,
        type: 'automation',
        cron: '* * * * *',
        enabled: true,
      });
    });
  });

  describe('call', () => {
    it('returns undefined without channelId', () => {
      expect(buildEntityData({ ...base, blockName: 'call' })).toBeUndefined();
    });

    it('builds a call with defaults', () => {
      expect(
        buildEntityData({ ...base, blockName: 'call', channelId: 'c-1' })
      ).toEqual({
        ...base,
        type: 'call',
        channelId: 'c-1',
        isActive: false,
        attended: false,
        participantIds: [],
      });
    });
  });

  describe('csv alias', () => {
    it('builds a csv document with fileType: csv', () => {
      const e = buildEntityData({ ...base, blockName: 'csv' });
      expect(e).toMatchObject({ type: 'document', fileType: 'csv' });
    });
  });
});
