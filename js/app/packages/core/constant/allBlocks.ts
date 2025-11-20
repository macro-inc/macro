import {
  type AnyBlockDefinition,
  type BlockName,
  BlockRegistry,
  type FileTypeString,
  type MimeType,
} from '@core/block';
import type { ItemType } from '@service-storage/client';
import type { BasicDocumentFileType } from '@service-storage/generated/schemas/basicDocumentFileType';
import { ENABLE_DOCX_TO_PDF } from './featureFlags';
import { DefaultFilename } from './filename';

export const blocks = Object.fromEntries(
  Object.values<AnyBlockDefinition>(
    import.meta.glob('../../block-*/definition.ts', {
      eager: true,
      import: 'definition',
    })
  ).map((definition) => [definition.name, definition])
) as Readonly<Record<BlockName, Readonly<AnyBlockDefinition>>>;

export const blockAcceptedMimetypeToFileExtension: Record<
  MimeType,
  FileTypeString
> = {};

export const blockAcceptedFileExtensionToMimeType: Record<
  FileTypeString,
  MimeType
> = {};

const fileTypeToBlockName_: Record<string, BlockName> = {};

export const blockAcceptedFileExtensionSet = new Set<string>();

// @ts-ignore This type is built below
export const blockNameToFileExtensionSet: Record<
  BlockName,
  Set<FileTypeString>
> = {};
// @ts-ignore This type is built below
export const blockNameToMimeTypeSet: Record<BlockName, Set<MimeType>> = {};
// @ts-ignore This type is built below
export const blockNameToDefaultFilename: Record<BlockName, string> = {};

for (const [name, block] of Object.entries(blocks)) {
  blockNameToFileExtensionSet[name as BlockName] = new Set();
  blockNameToMimeTypeSet[name as BlockName] = new Set();
  for (const [fileExtension, mimeType] of Object.entries(block.accepted)) {
    fileTypeToBlockName_[fileExtension] = name as BlockName;
    blockAcceptedFileExtensionSet.add(fileExtension);
    blockNameToFileExtensionSet[name as BlockName].add(fileExtension);
    if (!mimeType) continue;
    // first instance wins for now
    blockAcceptedMimetypeToFileExtension[mimeType] ??= fileExtension;
    blockNameToMimeTypeSet[name as BlockName].add(mimeType);
    blockAcceptedFileExtensionToMimeType[fileExtension] ??= mimeType;
  }
  if (block.defaultFilename) {
    blockNameToDefaultFilename[name as BlockName] = block.defaultFilename;
  }
}

export function blockAcceptsMimeType(blockName: BlockName, mimeType: MimeType) {
  return blockNameToMimeTypeSet[blockName].has(mimeType);
}

export function blockAcceptsFileExtension(
  blockName: BlockName,
  fileExtension: string
) {
  return blockNameToFileExtensionSet[blockName].has(fileExtension);
}

export const blockNameToFileExtensions = Object.fromEntries(
  Object.entries(blockNameToFileExtensionSet).map(([name, extensions]) => [
    name,
    Array.from(extensions),
  ])
) as Record<BlockName, string[]>;

export const blockNameToMimeTypes = Object.fromEntries(
  Object.entries(blockNameToMimeTypeSet).map(([name, mimeTypes]) => [
    name,
    Array.from(mimeTypes),
  ])
) as Record<BlockName, string[]>;

export const blockAcceptedMimeTypes = Object.keys(
  blockAcceptedMimetypeToFileExtension
);

export const blockAcceptedFileExtensions = Array.from(
  blockAcceptedFileExtensionSet
);

/**
 * Get the name of a block from a its own name or a file type. Built using the
 * types registered in block definitions.
 * @example
 * getBlockName('docx') // 'write'
 * getBlockName('svg') // 'image'
 * getBlockName('chat') // 'chat'
 * getBlockName('junk') // undefined
 * @param blockOrFiletype - The block name or file type like 'py', 'md', 'chat',
 *     'png', etc.
 * @param icon - Whether to return the icon name or the block name. In the case of
 *     'docx', icon should still show as docx icon, not pdf.
 * @return Either the name of the block or 'unknown' if there is no
 *     appropriate block.
 */
export function fileTypeToBlockName(
  blockOrFiletype?: string | null,
  // For docx: icon should still show as docx icon, not pdf
  icon?: boolean
): BlockName {
  if (!blockOrFiletype) return 'unknown';

  if (ENABLE_DOCX_TO_PDF) {
    if (blockOrFiletype === 'docx' || blockOrFiletype === 'write') {
      return icon ? 'write' : 'pdf';
    }
  }
  if (BlockRegistry.includes(blockOrFiletype as any)) {
    return blockOrFiletype as BlockName;
  }

  return fileTypeToBlockName_[blockOrFiletype] ?? 'unknown';
}

/**
 * Get the default display name for an unnamed file of a particular block.
 */
export function blockNameToDefaultFile(block?: BlockName | string) {
  if (!block) return DefaultFilename;
  if (block in blockNameToDefaultFilename) {
    return blockNameToDefaultFilename[block as BlockName];
  }
  return DefaultFilename;
}

type ItemLike = {
  type: ItemType;
  fileType?: BasicDocumentFileType;
  name?: string;
};

/**
 * Get a block name from an item-shaped object.
 * @example
 * itemToBlockName({ type: 'document', fileType: 'docx' }) // 'write'
 * itemToBlockName({ type: 'document', fileType: 'py' }) // 'code'
 * itemToBlockName({ type: 'chat' }) // 'chat'
 * @return The block name or undefined if there is no appropriate block.
 */
export function itemToBlockName(item: ItemLike): BlockName | undefined {
  if (item.fileType) {
    return fileTypeToBlockName(item.fileType);
  }
  return fileTypeToBlockName(item.type);
}

/**
 * Get the name of an item or its block-specific fallback name if the name in storage is
 *     the empty string.
 * @example
 * itemToSafeName({ type: 'document', fileType: 'md', fileName: 'My Cool Note' }) // 'My Cool Note'
 * itemToBlockName({ type: 'document', fileType: 'py' }) // 'Unknown Filename'
 * itemToBlockName({ type: 'chat' }) // 'New Chat'
 * @return A safe name for the item to display.
 */

export function itemToSafeName(item: ItemLike): string {
  if (typeof item.name === 'string' && item.name.length > 0) {
    return item.name;
  }
  return blockNameToDefaultFile(itemToBlockName(item));
}

/**
 * Return name as a known block name if it matches or 'unknown' if not found.
 * @returns
 */
export function verifyBlockName(name: string | undefined): BlockName {
  if (ENABLE_DOCX_TO_PDF && name === 'write') {
    return 'pdf';
  }
  if (name && name in blocks) return name as BlockName;
  return 'unknown';
}
