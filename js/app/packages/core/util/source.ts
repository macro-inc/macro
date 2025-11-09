import type { Source, SourceSyncService } from '@core/source';

export function isSourceSyncService(
  source: Source
): source is SourceSyncService {
  return 'type' in source && source.type === 'sync-service';
}

export function isSourceDSS(source: Source): source is SourceSyncService {
  return 'type' in source && source.type === 'dss';
}
