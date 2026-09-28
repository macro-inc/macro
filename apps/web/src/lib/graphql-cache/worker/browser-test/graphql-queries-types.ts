import type { EntityResolverWire } from '../../exchange/entity-resolvers';
import type { SelectedRecordByKeyWire } from '../../protocol';

export interface BenchmarkOperation {
  name: string;
  source: string;
  document: string;
  kind: 'query' | 'fragment';
  sizes: Array<{ size: number; files: string[] }>;
}

export interface BenchmarkCorpus {
  schema_hash: string;
  sizes: number[];
  variants: number[];
  cache_records?: number[];
  entity_resolvers: EntityResolverWire[];
  inventory: BenchmarkOperation[];
}

export interface BenchmarkFixture {
  variables: Record<string, unknown>;
  data: unknown;
  normalized_records: number;
  record_keys?: string[];
  populations?: Array<{ cache_records: number; file: string }>;
  seed_query?: string;
  expected?: SelectedRecordByKeyWire[];
}

export interface BrowserBenchmarkOptions {
  samples: number;
  warmup: number;
  cold_samples: number;
  sizes: number[];
  variants: number[];
  cache_records: number[];
  filter: string;
  scenarios: string[];
}

export interface BrowserBenchmarkRow {
  operation: string;
  size: number;
  scenario: string;
  normalized_records: number;
  cache_records?: number;
  hot_capacity?: number;
  requests_per_read?: number;
  samples: number;
  min_us: number;
  p50_us: number;
  p95_us: number;
  max_us: number;
  mean_us: number;
  samples_us: number[];
}

export interface BrowserBenchmarkResult {
  rows: BrowserBenchmarkRow[];
  cross_origin_isolated: boolean;
  timer_resolution_us: number;
}

declare global {
  interface Window {
    runGraphqlCacheBenchmark(
      corpus: BenchmarkCorpus,
      options: BrowserBenchmarkOptions
    ): Promise<BrowserBenchmarkResult>;
  }
}
