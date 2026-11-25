import { inboxLabelsOf } from '@queries/email/label-names';
import { describe, expect, it } from 'vitest';
import { labelTree, sidebarLabels } from './sidebar-labels';

const label = (
  id: string,
  name: string,
  linkId = 'gmail',
  labelListVisibility = 'LabelShow'
) => ({ id, linkId, name, labelListVisibility });

const GMAIL = { id: 'gmail', provider: 'GMAIL' };
const OUTLOOK = { id: 'outlook', provider: 'OUTLOOK' };

const names = (nodes: ReturnType<typeof labelTree>): unknown[] =>
  nodes.map((node) =>
    node.children.length > 0 ? [node.name, names(node.children)] : node.name
  );

describe('labelTree', () => {
  it('nests a Gmail label under its parent and keeps Outlook flat', () => {
    const entries = inboxLabelsOf(
      [
        label('larkspur', 'Customers/Larkspur'),
        label('customers', 'Customers'),
        label('acme', 'Customers/Acme'),
        label('board', 'Board/2026', 'outlook'),
      ],
      [GMAIL, OUTLOOK]
    );

    expect(
      names(labelTree(entries.filter((e) => e.linkId === 'gmail')))
    ).toEqual([['Customers', ['Acme', 'Larkspur']]]);
    expect(
      names(labelTree(entries.filter((e) => e.linkId === 'outlook')))
    ).toEqual(['Board/2026']);
  });
});

describe('sidebarLabels', () => {
  it('shows the first listed labels of each inbox and puts the rest behind more', () => {
    const entries = inboxLabelsOf(
      [
        ...['A', 'B', 'C', 'D'].map((name) => label(name, name)),
        label('hidden', 'Archive', 'gmail', 'LabelHide'),
        label('hidden-child', 'Archive/2019'),
        label('board', 'Board', 'outlook'),
      ],
      [OUTLOOK, GMAIL]
    );

    const inboxes = sidebarLabels(entries, 3);

    expect(inboxes.map((inbox) => inbox.linkId)).toEqual(['outlook', 'gmail']);
    expect(names(inboxes[0].shown)).toEqual(['Board']);
    expect(inboxes[0].more).toEqual([]);
    expect(names(inboxes[1].shown)).toEqual(['A', 'B', 'C']);
    // Gmail's hidden labels wait behind more with the rest, children and all.
    expect(names(inboxes[1].more)).toEqual([['Archive', ['2019']], 'D']);
  });
});
