import { describe, expect, it } from 'vitest';
import { actionLabel, documentKind } from './labels';

describe('card labels', () => {
  it('say what the agent did in the item’s own terms', () => {
    expect(actionLabel('document', 'created')).toBe('Created');
    expect(actionLabel('document', 'edited')).toBe('Edited');
    expect(actionLabel('calendar_event', 'created')).toBe('Scheduled');
    expect(actionLabel('calendar_event', 'edited')).toBe('Updated');
    expect(actionLabel('email_thread', 'sent')).toBe('Sent');
  });

  it('name a document by its kind', () => {
    expect(documentKind('md')).toBe('Document');
    expect(documentKind('spreadsheet')).toBe('Spreadsheet');
    expect(documentKind('pdf')).toBe('PDF');
    expect(documentKind(undefined)).toBe('Document');
    expect(documentKind('something-new')).toBe('Document');
  });
});
