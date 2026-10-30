import { storageServiceClient } from '@service-storage/client';
import type { ImportSourceInputs } from '../context/contracts';
import {
  createImportSource,
  type ImportSourceDependencies,
} from './import-source';

/** Bind the storage transport inside the query adapter, preserving test injection. */
export function createStorageImportSource(
  dependencies: Omit<ImportSourceDependencies, 'client'>,
  inputs: ImportSourceInputs
): ReturnType<typeof createImportSource> {
  return createImportSource(
    { ...dependencies, client: storageServiceClient },
    inputs
  );
}
