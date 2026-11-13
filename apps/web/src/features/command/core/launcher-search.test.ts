import { describe, expect, it } from 'vitest';
import type { CreatableBlock } from '../types';
import { searchLauncherBlocks } from './launcher-search';

const item = (
  label: string,
  description: string,
  keywords?: string[]
): CreatableBlock => ({
  label,
  hotkey: 'x' as CreatableBlock['hotkey'],
  blockName: 'md',
  description,
  keywords,
  keyDownHandler: () => true,
});

const labels = (items: CreatableBlock[]) => items.map((entry) => entry.label);

describe('searchLauncherBlocks', () => {
  it('puts a name match ahead of a recent option that only mentions the term', () => {
    // Routine comes first here, as it does when it was used most recently.
    const items = [
      item('Routine', 'Run a model or agent on a schedule or Macro activity'),
      item('Document', 'Create document'),
      item('Work agent', 'Create work agent'),
      item('Agent', 'Create agent session'),
    ];
    expect(labels(searchLauncherBlocks(items, 'agent'))).toEqual([
      'Agent',
      'Work agent',
      'Routine',
    ]);
  });

  it('ranks a name prefix above a name containing the term', () => {
    const items = [item('Spreadsheet', 'Sheet'), item('Sheet music', 'Notes')];
    expect(labels(searchLauncherBlocks(items, 'shee'))).toEqual([
      'Sheet music',
      'Spreadsheet',
    ]);
  });

  it('keeps the incoming order among equal matches', () => {
    const items = [
      item('Email', 'Write', ['message']),
      item('Message', 'Send'),
      item('Channel', 'Create', ['message']),
    ];
    expect(labels(searchLauncherBlocks(items, 'message'))).toEqual([
      'Message',
      'Email',
      'Channel',
    ]);
  });

  it('requires every term and returns everything for an empty query', () => {
    const items = [item('Agent', 'Create agent session'), item('Task', 'Do')];
    expect(labels(searchLauncherBlocks(items, 'agent session'))).toEqual([
      'Agent',
    ]);
    expect(labels(searchLauncherBlocks(items, 'agent nothing'))).toEqual([]);
    expect(searchLauncherBlocks(items, '  ')).toBe(items);
  });
});
