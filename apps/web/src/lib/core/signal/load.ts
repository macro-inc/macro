import { createBlockSignal, type LoadErrors } from '@core/block';
import type { OwnedBlockHandle } from '@core/orchestrator';
import type { Source } from '@core/source';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

// Derived signals for common DSS-based block data
export const blockErrorSignal = createBlockSignal<
  keyof typeof LoadErrors | 'UNKNOWN' | null
>();
/** Bumped by load-failure views to re-run the block's load. */
export const blockLoadRetrySignal = createBlockSignal<number>();
export const blockFileSignal = createBlockSignal<IDocumentStorageServiceFile>();
export const blockTextSignal = createBlockSignal<string>();
export const blockUserAccessSignal = createBlockSignal<UserAccessLevel>();
export const blockMetadataSignal = createBlockSignal<DocumentMetadata>();

// Derived signals for syncable documents
export const blockLoroManagerSignal = createBlockSignal<LoroManager>();
export const blockSyncSourceSignal = createBlockSignal<LiveSyncSource>();
export const blockSourceSignal = createBlockSignal<Source>();

export const blockEditPermissionEnabledSignal = createBlockSignal<boolean>();

export const blockHandleSignal = createBlockSignal<OwnedBlockHandle<any>>();
