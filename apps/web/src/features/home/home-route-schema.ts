import { channelsSearch } from '@app/features/channels-view/channels-route';
import {
  DRIVE_DOCUMENT_TYPES,
  type DriveDocumentType,
} from '@app/features/drive-view/primitives/drive-route-schema';
import { driveSearch } from '@app/features/drive-view/primitives/drive-search';
import {
  type BlockAlias,
  BlockAliasRegistry,
  type BlockName,
  BlockRegistry,
} from '@core/block';
import { z } from 'zod';

/**
 * The block an inline Home item opens. Aliases such as `task` name markdown
 * subtypes, as Drive's document routes do. `calendar` is not a block here:
 * the `home-calendar` route renders the Calendar view at `calendar/:period`.
 */
export const homePreviewRouteParams = z
  .object({
    blockType: z.enum([...BlockRegistry, ...BlockAliasRegistry] as const),
    previewId: z.string().min(1),
  })
  .refine(({ blockType }) => blockType !== 'write' && blockType !== 'calendar');

export type HomePreviewRouteParams = z.infer<typeof homePreviewRouteParams>;
export function isHomeDocumentType(value: string): value is DriveDocumentType {
  return (DRIVE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

const aliasBaseTypes: Record<BlockAlias, BlockName> = {
  csv: 'code',
  task: 'md',
  snippet: 'md',
  skill: 'md',
};

/**
 * The block an item's path names once aliases resolve, so `/home/task/<id>`
 * shares identity with `md:<id>`. Static so route declarations stay light
 * rather than loading every block definition.
 */
export function homeBaseBlockType(
  blockType: HomePreviewRouteParams['blockType']
): BlockName {
  return blockType in aliasBaseTypes
    ? aliasBaseTypes[blockType as BlockAlias]
    : (blockType as BlockName);
}

/** Search the inline Home item owns; the channel namespace is shared with the channels view. */
export const HOME_PREVIEW_SEARCH_NAMESPACES = [
  channelsSearch.namespace,
  driveSearch.namespace,
] as const;
