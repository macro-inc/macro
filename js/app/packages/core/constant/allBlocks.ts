import {
  type AnyBlockDefinition,
  type BlockAlias,
  type BlockName,
  BlockRegistry,
  type FileTypeString,
  type MimeType,
} from '@core/block';
import type { SubType } from '@macro-entity';
import type { ItemType } from '@service-storage/client';
import type { BasicDocumentSubTypeProperty } from '@service-storage/generated/schemas';
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

// Map from alias names to their base block names
const aliasToBlockName_: Record<string, BlockName> = {};

// Map from base block names to their aliases
export const blockNameToAliases: Partial<Record<BlockName, string[]>> = {};

export const blockAcceptedFileExtensionSet = new Set<string>();

// @ts-ignore This type is built below
export const blockNameToFileExtensionSet: Record<
  BlockName,
  Set<FileTypeString>
> = {};
// @ts-ignore This type is built below
export const blockNameToMimeTypeSet: Record<BlockName, Set<MimeType>> = {};
export const blockNameToDefaultFilename: Partial<
  Record<BlockName | BlockAlias, string>
> = {};

for (const [name, block] of Object.entries(blocks)) {
  blockNameToFileExtensionSet[name as BlockName] = new Set();
  blockNameToMimeTypeSet[name as BlockName] = new Set();

  // Process aliases
  if (block.aliases) {
    blockNameToAliases[name as BlockName] = block.aliases.map(
      (alias) => alias.name
    );
    for (const alias of block.aliases) {
      aliasToBlockName_[alias.name] = name as BlockName;
      if (alias.defaultFileName) {
        blockNameToDefaultFilename[alias.name] = alias.defaultFileName;
      }
    }
  } else {
    blockNameToAliases[name as BlockName] = [];
  }

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
 * Check if a string is a block alias
 */
export function isBlockAlias(name: string): name is BlockAlias {
  return name in aliasToBlockName_;
}

/**
 * Get the base block name for an alias, or return the original name if not an alias
 */
export function resolveBlockAlias(name: BlockName | BlockAlias): BlockName {
  return aliasToBlockName_[name] || (name as BlockName);
}

/**
 * Get the name of a block from a its own name or a file type. Built using the
 * types registered in block definitions.
 * @example
 * getBlockName('docx') // 'write'
 * getBlockName('svg') // 'image'
 * getBlockName('chat') // 'chat'
 * getBlockName('task') // 'task'
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
): BlockName | BlockAlias {
  if (!blockOrFiletype) return 'unknown';

  if (ENABLE_DOCX_TO_PDF) {
    if (blockOrFiletype === 'docx' || blockOrFiletype === 'write') {
      return icon ? 'write' : 'pdf';
    }
  }

  if (isBlockAlias(blockOrFiletype)) {
    return blockOrFiletype;
  }

  if (BlockRegistry.includes(blockOrFiletype as any)) {
    return blockOrFiletype as BlockName;
  }

  return fileTypeToBlockName_[blockOrFiletype] ?? 'unknown';
}

/**
 * Get the name of a block from a its own name, aliased name,  or a file type.
 * @example
 * getBlockName('task') // 'md'
 * getBlockName('junk') // undefined
 * @param blockOrFiletype - The block name or file type like 'py', 'md', 'chat',
 *     'png', etc.
 * @return Either the name of the block or 'unknown' if there is no
 *     appropriate block.
 */
export function fileTypeToResolvedBlockName(
  blockOrFiletype?: string | null
): BlockName {
  return resolveBlockAlias(fileTypeToBlockName(blockOrFiletype));
}

/**
 * Get the default display name for an unnamed file of a particular block.
 */
export function blockNameToDefaultFile(block?: BlockName | string | null) {
  if (!block) return DefaultFilename;
  if (block in blockNameToDefaultFilename) {
    return (
      blockNameToDefaultFilename[block as BlockName | BlockAlias] ||
      DefaultFilename
    );
  }
  return DefaultFilename;
}

type ItemLike = {
  type: ItemType;
  fileType?: BasicDocumentFileType;
  subType?: SubType | BasicDocumentSubTypeProperty;
  name?: string;
};

/**
 * Get a block name from an item-shaped object.
 * @example
 * itemToBlockName({ type: 'document', fileType: 'docx' }) // 'write'
 * itemToBlockName({ type: 'document', fileType: 'py' }) // 'code'
 * itemToBlockName({ type: 'document', fileType: 'md', subType: { type: 'task', is_completed: false } }) // 'task'
 * itemToBlockName({ type: 'chat' }) // 'chat'
 * @return The block name or undefined if there is no appropriate block.
 */
export function itemToBlockName(
  item: ItemLike,
  icon?: boolean
): BlockName | BlockAlias | undefined {
  const subTypeName =
    item.subType && 'type' in item.subType
      ? (item.subType.type as string)
      : undefined;
  if (subTypeName && isBlockAlias(subTypeName)) {
    return subTypeName;
  }
  if (item.fileType) {
    return fileTypeToBlockName(item.fileType, icon);
  }
  return fileTypeToBlockName(item.type, icon);
}

/**
 * Get a flattened block name from an item-shaped object. Ignoring any block \
 * aliases.
 * @example
 * itemToBlockName({ type: 'document', fileType: 'md', subType: 'task' }) // 'md'
 * @return The block name or undefined if there is no appropriate block.
 */
export function itemToResolvedBlockName(item: ItemLike) {
  const maybeAliased = itemToBlockName(item);
  if (!maybeAliased) return;
  return resolveBlockAlias(maybeAliased);
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
  return blockNameToDefaultFile(itemToBlockName(item) || 'unknown');
}

/**
 * Return name as a known block name if it matches or 'unknown' if not found.
 * @returns
 */
export function verifyBlockName(
  name: string | undefined
): BlockName | BlockAlias {
  if (!name) return 'unknown';
  if (ENABLE_DOCX_TO_PDF && name === 'write') {
    return 'pdf';
  }
  if (isBlockAlias(name)) return name;
  if (name && name in blocks) return name as BlockName;
  return 'unknown';
}
