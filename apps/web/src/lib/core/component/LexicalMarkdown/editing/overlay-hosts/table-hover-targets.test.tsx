/** @vitest-environment jsdom */

import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableRowNode,
  TableCellHeaderStates,
} from '@lexical/table';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { $getNodeByKey, $getRoot } from 'lexical';
import { render } from 'solid-js/web';
import { beforeAll, expect, test, vi } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { HostedTableDeleteButtons } from '../../component/misc/TableDeleteButtons';
import { deleteNativeTableAtHover } from '../../plugins/tables/native';
import { tablePlugin } from '../../plugins/tables/tablePlugin';
import table from '../table-hover-browser-test/fixtures/table.json';
import { createLexicalTableDeleteHost } from './lexical-table-delete';
import { createNativeTableHoverHost } from './native-table-hover';

beforeAll(initializeNativeSurfaceTests);

test('Source hovered delete retains its model target after a real header DOM replacement', () => {
  const fixture = behaviorEditor(tablePlugin({ hasCellMerge: true }));
  let cellKey = '';
  fixture.editor.update(
    () => {
      const table = $createTableNodeWithDimensions(3, 3, false);
      $getRoot().append(table);
      const row = table.getChildAtIndex(1);
      if (!$isTableRowNode(row)) throw new Error('Expected actual Source row');
      const cell = row.getFirstChild();
      if (!$isTableCellNode(cell))
        throw new Error('Expected actual Source cell');
      cellKey = cell.getKey();
    },
    { discrete: true }
  );
  const cell = fixture.editor.getElementByKey(cellKey);
  const tableDOM = fixture.root.querySelector('table');
  if (!cell || !tableDOM) throw new Error('Missing actual Source table DOM');
  const cellRect = vi
    .spyOn(cell, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 60, 100, 40));
  const tableRect = vi
    .spyOn(tableDOM, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 20, 300, 120));
  const host = createLexicalTableDeleteHost(() => fixture.editor);
  const container = document.createElement('div');
  document.body.append(container);
  const unmount = render(
    () => <HostedTableDeleteButtons host={host} />,
    container
  );
  try {
    cell.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 21, clientY: 80 })
    );
    const button = document.querySelector('button[aria-label="Delete row"]');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Missing actual hover button');
    fixture.editor.update(
      () => {
        const target = $getNodeByKey(cellKey);
        if (!$isTableCellNode(target))
          throw new Error('Expected current Source target');
        target.setHeaderStyles(TableCellHeaderStates.ROW);
      },
      { discrete: true }
    );
    expect(cell.isConnected).toBe(false);
    expect(fixture.editor.getElementByKey(cellKey)?.tagName).toBe('TH');
    expect(document.querySelector('button[aria-label="Delete row"]')).toBe(
      button
    );
    button.click();
    fixture.editor.read(() => {});
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(2);
  } finally {
    unmount();
    container.remove();
    cellRect.mockRestore();
    tableRect.mockRestore();
  }
});

test('native hovered delete uses its captured attached model target after its DOM detaches', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  const cell = fixture.root.querySelectorAll('td')[3];
  const tableDOM = fixture.root.querySelector('table');
  if (!cell || !tableDOM) throw new Error('Missing actual native cell');
  const tableKey = fixture.view.keyFromDOM(tableDOM);
  if (tableKey === null) throw new Error('Missing actual native table key');
  const cellRect = vi
    .spyOn(cell, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 60, 100, 40));
  const tableRect = vi
    .spyOn(tableDOM, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 20, 300, 120));
  const resource = createNativeTableHoverHost(fixture.view, () => true);
  const container = document.createElement('div');
  document.body.append(container);
  const unmount = render(
    () => <HostedTableDeleteButtons host={resource.deleteHost} />,
    container
  );
  try {
    cell.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 21, clientY: 80 })
    );
    const button = document.querySelector('button[aria-label="Delete row"]');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Missing actual native hover button');
    // This isolates the captured-model-target boundary, not a native header
    // mutation producer or an actual renderer remount. The model stays real.
    cell.remove();
    expect(fixture.view.node(tableKey)?.children).toHaveLength(3);
    expect(document.querySelector('button[aria-label="Delete row"]')).toBe(
      button
    );
    button.click();
    expect(fixture.view.node(tableKey)?.children).toHaveLength(2);
  } finally {
    unmount();
    resource.dispose();
    container.remove();
    cellRect.mockRestore();
    tableRect.mockRestore();
    fixture.close();
  }
});

test('captured native delete cannot write after UI permission loss, retirement or disposal', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  let editable = true;
  const resource = createNativeTableHoverHost(fixture.view, () => editable);
  try {
    const hit = resource.deleteHost.cellFromTarget(
      fixture.root.querySelector('td')
    );
    if (!hit) throw new Error('Missing actual owned target');
    const before = fixture.session.serializedState();
    editable = false;
    resource.deleteHost.deleteAt(hit, 'row');
    expect(fixture.session.serializedState()).toBe(before);
    editable = true;
    fixture.view.setEditable(false);
    resource.deleteHost.deleteAt(hit, 'column');
    expect(fixture.session.serializedState()).toBe(before);
    fixture.view.setEditable(true);
    resource.dispose();
    resource.deleteHost.deleteAt(hit, 'row');
    expect(fixture.session.serializedState()).toBe(before);
    fixture.view.dispose();
    resource.deleteHost.deleteAt(hit, 'table');
    expect(fixture.session.serializedState()).toBe(before);
  } finally {
    resource.dispose();
    fixture.close();
  }
});

test('removed, mismatched-generation and current wrong-type targets cannot delete content', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  const resource = createNativeTableHoverHost(fixture.view, () => true);
  try {
    const hit = resource.deleteHost.cellFromTarget(
      fixture.root.querySelector('td')
    );
    if (!hit) throw new Error('Missing actual owned target');
    const row = fixture.root.querySelector('tr');
    const rowKey = row && fixture.view.keyFromDOM(row);
    if (rowKey === null || rowKey === undefined)
      throw new Error('Missing actual row key');
    const initial = fixture.session.serializedState();
    deleteNativeTableAtHover(fixture.view, rowKey, 'table');
    expect(fixture.session.serializedState()).toBe(initial);
    deleteNativeTableAtHover(fixture.view, hit.key.index, 'table');
    expect(fixture.view.mirror.keyGeneration).toBe(hit.key.generation);
    const removed = fixture.session.serializedState();
    resource.deleteHost.deleteAt(hit, 'row');
    expect(fixture.session.serializedState()).toBe(removed);
    fixture.port.setState(JSON.stringify(table));
    const current = resource.deleteHost.cellFromTarget(
      fixture.root.querySelector('td')
    );
    if (!current) throw new Error('Missing actual replacement cell');
    const replacement = fixture.session.serializedState();
    resource.deleteHost.deleteAt(
      {
        ...current,
        key: { ...current.key, generation: current.key.generation + 1 },
      },
      'column'
    );
    expect(fixture.session.serializedState()).toBe(replacement);
  } finally {
    resource.dispose();
    fixture.close();
  }
});

test('Session read-only admission rejects a captured delete despite editable UI', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  const resource = createNativeTableHoverHost(fixture.view, () => true);
  try {
    const hit = resource.deleteHost.cellFromTarget(
      fixture.root.querySelector('td')
    );
    if (!hit) throw new Error('Missing actual owned target');
    const flags = fixture.session.authorization(true, false, false, 2, 2);
    if (flags & (1 | 2 | 8 | 16)) {
      const output = decodeOutput(fixture.session.takeOutput());
      fixture.view.apply(output.view, output.strings, output.viewEffects);
    }
    fixture.view.setEditable(true);
    const errors: unknown[] = [];
    const error = vi
      .spyOn(fixture.view.options, 'onError')
      .mockImplementation((value) => {
        errors.push(value);
      });
    const before = fixture.session.serializedState();
    resource.deleteHost.deleteAt(hit, 'row');
    expect(fixture.session.effectiveAccess()).toBe(Access.Read);
    expect(fixture.session.serializedState()).toBe(before);
    expect(errors).toEqual([new Error('document is read-only')]);
    error.mockRestore();
  } finally {
    resource.dispose();
    fixture.close();
  }
});

test('only the original view model cell can be captured, excluding nested DOM and foreign views', () => {
  const fixture = nativeSurface();
  const other = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  other.port.setState(JSON.stringify(table));
  const resource = createNativeTableHoverHost(fixture.view, () => true);
  try {
    const cell = fixture.root.querySelector('td');
    const foreign = other.root.querySelector('td');
    if (!cell || !foreign) throw new Error('Missing actual view cells');
    expect(resource.deleteHost.cellFromTarget(cell)).toBeTruthy();
    expect(resource.deleteHost.cellFromTarget(foreign)).toBeFalsy();
    cell.append(other.root);
    expect(resource.deleteHost.cellFromTarget(foreign)).toBeFalsy();
    const nestedTable = document.createElement('table');
    const nestedRow = document.createElement('tr');
    const nestedCell = document.createElement('td');
    nestedRow.append(nestedCell);
    nestedTable.append(nestedRow);
    cell.append(nestedTable);
    expect(resource.deleteHost.cellFromTarget(nestedCell)).toBeFalsy();
  } finally {
    resource.dispose();
    other.close();
    fixture.close();
  }
});
