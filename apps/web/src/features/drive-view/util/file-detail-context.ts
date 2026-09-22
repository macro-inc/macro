import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

export type FileDetailContext<T> = {
  data: T;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  operations?: FileOperation[];
};
