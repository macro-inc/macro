import { describe, expect, it } from 'vitest';
import {
  driveCreateDestinationLabel,
  driveLocationLabel,
} from './location-label';

describe('drive location labels', () => {
  const folders = [
    { id: 'f1', name: 'Product' },
    { id: 'f2', name: 'Specs', parentId: 'f1' },
  ];

  it('labels tabs including starred and trash', () => {
    expect(driveLocationLabel({ kind: 'tab', tab: 'owned' }, folders)).toBe(
      'My Files'
    );
    expect(driveLocationLabel({ kind: 'tab', tab: 'recent' }, folders)).toBe(
      'Recent'
    );
    expect(driveLocationLabel({ kind: 'tab', tab: 'shared' }, folders)).toBe(
      'Shared with me'
    );
    expect(driveLocationLabel({ kind: 'tab', tab: 'starred' }, folders)).toBe(
      'Starred'
    );
    expect(driveLocationLabel({ kind: 'tab', tab: 'trash' }, folders)).toBe(
      'Trash'
    );
  });

  it('labels folders and create destinations', () => {
    expect(driveLocationLabel({ kind: 'folder', id: 'f2' }, folders)).toBe(
      'Specs'
    );
    expect(driveLocationLabel({ kind: 'folder', id: null }, folders)).toBe(
      'Drive'
    );
    expect(driveCreateDestinationLabel(undefined, folders)).toBe('Drive');
    expect(driveCreateDestinationLabel('f1', folders)).toBe('Product');
  });
});
