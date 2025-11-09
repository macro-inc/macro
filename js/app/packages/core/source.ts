export interface WithName {
  name: string;
}

export interface WithId {
  /** UUID */
  id: string;
}

export interface SourceUnset {
  type: 'unset';
}

/* Remote sources */
export interface SourceDSS extends WithId {
  type: 'dss';
  version?: number;
}

export interface SourceDSSWithName extends SourceDSS, WithName {}

export interface SourceDSSWithUpload extends SourceDSSWithName {
  upload: File;
}

export interface SourceSyncService extends WithId {
  type: 'sync-service';
}

/* Local sources
 *
 * Some use cases:
 * 1. Before something is fully uploaded it must have a representation
 * 2. An embedded document, such as a PNG that's inside of a Word document
 * 3. A remote asset that is pulled then processed,
 *    like archiving a website using wget
 * 4. Anything that is produced but not committed
 * 5. Temporary assets that are shared across workers
 */

export interface SourceBlob extends WithName {
  type: 'blob';
  blob: Blob;
}

export interface SourceArrayBuffer extends WithName {
  type: 'buffer';
  buffer: ArrayBufferLike;
}

export interface SourceOPFS extends WithName {
  type: 'opfs';
  /** should this OPFS be discarded after upload */
  temporary: boolean;
}

export type SourceNotGenerated =
  | SourceUnset
  | SourceDSS
  | SourceDSSWithName
  | SourceDSSWithUpload
  | SourceBlob
  | SourceArrayBuffer
  | SourceOPFS
  | SourceSyncService;

// Generated
export interface SourceGenerated {
  type: 'gen';
  origin: SourceNotGenerated;
  /** If generated locally, it may not be on DSS automatically */
  sharedAs?: SourceDSS;
}

/** An intermediate preload that can be be used to complete a request */
export type SourcePreload<T extends Record<string, any>> = {
  type: 'preload';
  origin: SourceNotGenerated;
} & T;

export type Source = SourceNotGenerated | SourceGenerated;

export function sourceName(
  source: Source | SourcePreload<any>
): string | undefined {
  return (source as WithName).name;
}

export function sourceUpload(
  source: Source | SourcePreload<any>
): File | undefined {
  return (source as SourceDSSWithUpload).upload;
}

export async function sourceToArrayBufferLike(
  source: Source
): Promise<ArrayBufferLike | undefined> {
  switch (source.type) {
    case 'blob':
      return source.blob.arrayBuffer();
    case 'buffer':
      return source.buffer;
    case 'gen': {
      return sourceToArrayBufferLike(source.origin);
    }
  }
  return undefined;
}
