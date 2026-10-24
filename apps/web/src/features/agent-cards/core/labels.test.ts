import { describe, expect, it } from 'vitest';
import { actionLabel, actionTone, documentKind, itemKind } from './labels';

describe('card labels', () => {
  it('say what the agent did in the item’s own terms', () => {
    expect(actionLabel('document', 'created')).toBe('Created');
    expect(actionLabel('document', 'edited')).toBe('Edited');
    expect(actionLabel('calendar_event', 'created')).toBe('Scheduled');
    expect(actionLabel('calendar_event', 'edited')).toBe('Updated');
    expect(actionLabel('email_thread', 'sent')).toBe('Sent');
    expect(actionLabel('channel', 'sent')).toBe('Posted');
    expect(actionLabel('calendar_event', 'deleted')).toBe('Canceled');
    expect(actionLabel('document', 'moved')).toBe('Moved');
  });

  it('keep failure and removal from reading as good news', () => {
    expect(actionTone('created')).toBe('accent');
    expect(actionTone('deleted')).toBe('neutral');
    expect(actionTone('failed')).toBe('bad');
  });

  it('name any item by its kind', () => {
    expect(itemKind('document', 'spreadsheet')).toBe('Spreadsheet');
    expect(itemKind('routine')).toBe('Routine');
    expect(itemKind('email_thread')).toBe('Email');
    expect(itemKind('project')).toBe('Folder');
    expect(itemKind('initiative')).toBe('Project');
  });

  it('name a document by its kind', () => {
    expect(documentKind('md')).toBe('Document');
    expect(documentKind('spreadsheet')).toBe('Spreadsheet');
    expect(documentKind('pdf')).toBe('PDF');
    expect(documentKind(undefined)).toBe('Document');
    expect(documentKind('something-new')).toBe('Document');
  });
});
