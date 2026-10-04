import type { DocxPackageState } from '@macro-inc/collaboration/docx/schema';
import { splitPackage } from './docx-package';

/** The Docxodus session bridge calls the collaboration layer uses. */
export type DocxSyncBridge = {
  SaveWithAnchorIds?: (handle: number) => Uint8Array;
  ListAnchors?: (handle: number) => string;
  RawReplaceXml?: (handle: number, anchor: string, xml: string) => string;
  RawInsertXml?: (
    handle: number,
    anchor: string,
    position: string,
    xml: string
  ) => string;
  DeleteBlock: (handle: number, anchor: string) => string;
  MoveBlock?: (
    handle: number,
    source: string,
    target: string,
    position: string
  ) => string;
};

export type BlockPosition = 'before' | 'after';

/** Engine operations over one live document session. */
export type DocxEngine = {
  /** The session's current document, split the way collaboration stores it. */
  snapshot(): DocxPackageState;
  /** Body block id → the engine anchor that addresses it. */
  bodyAnchors(): Map<string, string>;
  replaceBlock(anchor: string, xml: string): boolean;
  insertBlock(anchor: string, position: BlockPosition, xml: string): boolean;
  deleteBlock(anchor: string): boolean;
  moveBlock(source: string, target: string, position: BlockPosition): boolean;
};

export class DocxEngineUnsupportedError extends Error {}

function succeeded(result: string | undefined): boolean {
  if (!result) return false;
  try {
    const parsed: unknown = JSON.parse(result);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'success' in parsed &&
      parsed.success === true
    );
  } catch {
    return false;
  }
}

function require<T>(value: T | undefined, name: string): T {
  if (value === undefined)
    throw new DocxEngineUnsupportedError(
      `This Docxodus build lacks ${name}, which collaboration requires.`
    );
  return value;
}

type AnchorIndex = Record<string, { unid?: string; scope?: string }>;

export function bridgeEngine(
  bridge: DocxSyncBridge,
  handle: () => number
): DocxEngine {
  const save = require(bridge.SaveWithAnchorIds, 'SaveWithAnchorIds');
  const listAnchors = require(bridge.ListAnchors, 'ListAnchors');
  const replace = require(bridge.RawReplaceXml, 'RawReplaceXml');
  const insert = require(bridge.RawInsertXml, 'RawInsertXml');
  return {
    snapshot: () => splitPackage(save(handle())),
    bodyAnchors() {
      const parsed = JSON.parse(listAnchors(handle())) as {
        anchorIndex?: AnchorIndex;
      };
      const anchors = new Map<string, string>();
      for (const [anchor, info] of Object.entries(parsed.anchorIndex ?? {})) {
        if (info.scope === 'body' && info.unid) anchors.set(info.unid, anchor);
      }
      return anchors;
    },
    replaceBlock: (anchor, xml) => succeeded(replace(handle(), anchor, xml)),
    insertBlock: (anchor, position, xml) =>
      succeeded(insert(handle(), anchor, position, xml)),
    deleteBlock: (anchor) => succeeded(bridge.DeleteBlock(handle(), anchor)),
    moveBlock: (source, target, position) =>
      bridge.MoveBlock
        ? succeeded(bridge.MoveBlock(handle(), source, target, position))
        : false,
  };
}
