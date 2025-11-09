import { createBlockSignal, type LoadErrors } from '@core/block';
import type { LoroManager } from '@core/collab/manager';
import type { SyncSource } from '@core/collab/source';
import type { OwnedBlockHandle } from '@core/orchestrator';
import type { Source } from '@core/source';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

// Derived signals for common DSS-based block data
export const blockErrorSignal = createBlockSignal<
  keyof typeof LoadErrors | 'UNKNOWN' | null
>();
export const blockFileSignal = createBlockSignal<IDocumentStorageServiceFile>();
export const blockTextSignal = createBlockSignal<string>();
export const blockUserAccessSignal = createBlockSignal<UserAccessLevel>();
export const blockMetadataSignal = createBlockSignal<DocumentMetadata>();

// Derived signals for syncable documents
export const blockLoroManagerSignal = createBlockSignal<LoroManager>();
export const blockSyncSourceSignal = createBlockSignal<SyncSource>();
export const blockSourceSignal = createBlockSignal<Source>();

export const blockEditPermissionEnabledSignal = createBlockSignal<boolean>();

export const blockHandleSignal = createBlockSignal<OwnedBlockHandle<any>>();
