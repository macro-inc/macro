/**
 * The catalog fixtures from `crates/database_sql/fixtures/catalogs`: a schema,
 * a scope, and the catalog the engine's builder makes of them. The browser's
 * tests show a database detail maps onto the same schema, so the catalog a
 * statement runs against is the one the Rust side pins.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Catalog, Schema } from '../generated/types';

export interface CatalogFixture {
  schema: Schema;
  scope: string | null;
  catalog: Catalog;
}

export function readCatalogFixture(name: string): CatalogFixture {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        `../../../../../../../crates/database_sql/fixtures/catalogs/${name}.json`
      ),
      'utf8'
    )
  );
}
