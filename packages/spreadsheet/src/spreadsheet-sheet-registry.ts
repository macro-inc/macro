import type { LoroDoc } from 'loro-crdt';
import { formulaReferencesSheet } from './sheet-references';

export const DEFAULT_SHEET_ID = 'sheet1';
export type SpreadsheetSheet = { id: string; name: string };

export function isSpreadsheetSheetId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

export function validateSpreadsheetSheetName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 31)
    throw new Error('Sheet names must contain between 1 and 31 characters.');
  if (
    /[\[\]:*?/\\]/.test(normalized) ||
    [...normalized].some((character) => character.charCodeAt(0) < 32) ||
    /^'|'$/.test(normalized)
  )
    throw new Error(
      'Sheet names cannot contain [ ] : * ? / \\ or start or end with an apostrophe.'
    );
  return normalized;
}

function validRemoteName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return validateSpreadsheetSheetName(value) === value;
  } catch {
    return false;
  }
}

type RetainedIdentity = { name: string; order: number; revision: number };

function retainedIdentity(value: unknown): RetainedIdentity | undefined {
  if (typeof value !== 'string' || value.length > 512) return;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !data ||
      typeof data !== 'object' ||
      !('name' in data) ||
      !validRemoteName(data.name) ||
      !('order' in data) ||
      typeof data.order !== 'number' ||
      !Number.isFinite(data.order) ||
      !('revision' in data) ||
      typeof data.revision !== 'number' ||
      !Number.isFinite(data.revision)
    )
      return;
    return { name: data.name, order: data.order, revision: data.revision };
  } catch {
    return;
  }
}

function readRetainedIdentities(doc: LoroDoc): Map<string, RetainedIdentity> {
  const retained = new Map<string, RetainedIdentity>();
  // Causally newer metadata wins; sorted peer keys break concurrent ties.
  for (const [key, value] of Object.entries(
    doc.getMap('spreadsheetSheetRetentions').toJSON()
  ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const separator = key.indexOf('!');
    if (separator === -1) continue;
    const id = key.slice(0, separator);
    const identity = retainedIdentity(value);
    if (!isSpreadsheetSheetId(id) || !identity) continue;
    const previous = retained.get(id);
    if (!previous || identity.revision > previous.revision)
      retained.set(id, identity);
  }
  return retained;
}

/** Registry defaults never write state, so opening a legacy sheet is read-only. */
export function readSpreadsheetSheets(doc: LoroDoc): SpreadsheetSheet[] {
  const names = doc.getMap('spreadsheetSheetNames').toJSON();
  const order = doc.getMap('spreadsheetSheetOrder').toJSON();
  const deleted = doc.getMap('spreadsheetDeletedSheets').toJSON();
  const retained = readRetainedIdentities(doc);
  const revived = new Set(
    Object.values(doc.getMap('spreadsheetSheetRevivals').toJSON())
  );
  const ids = new Set([
    DEFAULT_SHEET_ID,
    ...Object.keys(names),
    ...retained.keys(),
  ]);
  const candidates = [...ids]
    .filter(
      (id) =>
        isSpreadsheetSheetId(id) &&
        (id === DEFAULT_SHEET_ID ||
          validRemoteName(names[id]) ||
          retained.has(id))
    )
    .map((id) => ({
      id,
      name: validRemoteName(names[id])
        ? names[id]
        : (retained.get(id)?.name ?? 'Sheet1'),
      order:
        typeof order[id] === 'number' && Number.isFinite(order[id])
          ? order[id]
          : retained.has(id)
            ? retained.get(id)!.order
            : id === DEFAULT_SHEET_ID
              ? 0
              : Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
  const live = candidates.filter(
    (sheet) => deleted[sheet.id] !== true || revived.has(sheet.id)
  );
  // Concurrent deletes may each remove the other's last surviving sheet.
  // Keep one deterministic fallback visible; retained cell maps make recovery
  // and undo lossless, including edits received after a deletion.
  const visible = live.length ? live : candidates.slice(0, 1);
  const reserved = new Set(visible.map((sheet) => sheet.name.toLowerCase()));
  const assigned = new Set<string>();
  return visible.map(({ id, name }) => {
    let unique = name;
    let suffix = 2;
    if (assigned.has(unique.toLowerCase())) {
      do {
        const ending = ` (${suffix++})`;
        unique = `${name.slice(0, 31 - ending.length)}${ending}`;
      } while (
        assigned.has(unique.toLowerCase()) ||
        reserved.has(unique.toLowerCase())
      );
    }
    assigned.add(unique.toLowerCase());
    return { id, name: unique };
  });
}

/** Keep another peer's sheet identity when undo removes its original creation.
 * One record per peer/sheet bounds growth. The record belongs to the same undo
 * step as the edit, so undoing unused creation still removes the whole sheet.
 * Retention does not override an explicit deletion tombstone.
 */
export function retainSpreadsheetSheets(
  doc: LoroDoc,
  sheetId: string,
  formulas: string[] = []
): void {
  const retentions = doc.getMap('spreadsheetSheetRetentions');
  const identities = readRetainedIdentities(doc);
  const order = doc.getMap('spreadsheetSheetOrder');
  for (const sheet of readSpreadsheetSheets(doc)) {
    if (sheet.id === DEFAULT_SHEET_ID) continue;
    if (
      sheet.id !== sheetId &&
      !formulas.some((formula) => formulaReferencesSheet(formula, sheet.name))
    )
      continue;
    const storedOrder = order.get(sheet.id);
    const sheetOrder =
      typeof storedOrder === 'number' && Number.isFinite(storedOrder)
        ? storedOrder
        : (identities.get(sheet.id)?.order ?? Number.MAX_SAFE_INTEGER);
    const key = `${sheet.id}!${doc.peerIdStr}`;
    const existing = retainedIdentity(retentions.get(key));
    if (existing?.name === sheet.name && existing.order === sheetOrder)
      continue;
    // Version-vector totals increase across causally ordered metadata updates,
    // without relying on local wall clocks when reconstructing an undone name.
    const revision = Object.values(doc.version().toJSON()).reduce<number>(
      (total, counter) => total + Number(counter),
      0
    );
    retentions.set(
      key,
      JSON.stringify({ name: sheet.name, order: sheetOrder, revision })
    );
  }
}

/** Preserve the retained last sheet only when an explicit operation uses it.
 * Reading/hydrating a document must never revive a deleted sheet. A late edit
 * targeting a hidden sheet must not revive it either.
 */
export function reviveSpreadsheetFallback(
  doc: LoroDoc,
  sheetId?: string
): void {
  const deleted = doc.getMap('spreadsheetDeletedSheets');
  const revivals = doc.getMap('spreadsheetSheetRevivals');
  const revived = new Set(Object.values(revivals.toJSON()));
  if (
    sheetId !== undefined &&
    deleted.get(sheetId) !== true &&
    !revived.has(sheetId)
  )
    return;
  for (const sheet of readSpreadsheetSheets(doc)) {
    if (sheetId !== undefined && sheet.id !== sheetId) continue;
    if (deleted.get(sheet.id) !== true && !revived.has(sheet.id)) continue;
    // A peer's later edits must be undone before its original revival. One
    // marker per peer/sheet therefore bounds growth while a different peer's
    // edit still survives undo restoring the old shared tombstone. Reading and
    // deletion remain value-based to preserve older UUID-keyed markers.
    const key = `${sheet.id}!${doc.peerIdStr}`;
    if (revivals.get(key) !== sheet.id) revivals.set(key, sheet.id);
    if (deleted.get(sheet.id) === true) deleted.set(sheet.id, false);
  }
}

/** Explicit deletion removes observed revivals, never an unseen peer's edit. */
export function tombstoneSpreadsheetSheet(doc: LoroDoc, sheetId: string): void {
  const revivals = doc.getMap('spreadsheetSheetRevivals');
  for (const [key, revivedId] of Object.entries(revivals.toJSON())) {
    if (revivedId === sheetId) revivals.delete(key);
  }
  const retentions = doc.getMap('spreadsheetSheetRetentions');
  for (const key of retentions.keys()) {
    if (key.startsWith(`${sheetId}!`)) retentions.delete(key);
  }
  doc.getMap('spreadsheetDeletedSheets').set(sheetId, true);
}
