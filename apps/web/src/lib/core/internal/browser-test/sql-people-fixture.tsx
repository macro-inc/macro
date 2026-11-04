import { fireAndForget } from '@core/util/fireAndForget';
import { createDatabaseSqlQuery } from '@queries/database-sql/create-database-sql-query';
import { readServerSql } from '@queries/database-sql/server-read';
import { createSignal } from 'solid-js';
import { account, setAccount } from './test-account';

/** Real compiler/WASM, query controller, response validation and HTTP transport.
 * The endpoint is intercepted by Playwright; no legacy contact source is injected. */
export function SqlPeopleFixture() {
  const [sql, setSql] = createSignal(
    'SELECT COUNT(*) AS total FROM macro.people'
  );
  const query = createDatabaseSqlQuery(
    () => ({ schema: { databases: [], platform: ['people'] }, sql: sql() }),
    {
      account,
      client: () => {
        throw new Error(
          'A people statement must not construct browser row sources'
        );
      },
      cacheHost: () => undefined,
      serverRead: readServerSql,
    }
  );
  return (
    <main class="h-dvh overflow-auto p-4 bg-page text-ink flex flex-col gap-3">
      <label>
        SQL
        <textarea
          aria-label="SQL"
          class="border border-edge bg-input p-2 block w-full"
          value={sql()}
          onInput={(event) => setSql(event.currentTarget.value)}
        />
      </label>
      <button onClick={() => fireAndForget(query.refresh(), 'sql-fixture')}>
        Refresh read
      </button>
      <button
        onClick={() =>
          setAccount({ ...account(), session: account().session + 1 })
        }
      >
        Replace login
      </button>
      <output data-testid="sql-loading">{String(query.loading())}</output>
      <output data-testid="sql-cached">{String(query.cached())}</output>
      <p role="alert">
        {query.error()?.kind === 'read-only'
          ? 'Read only'
          : query.error()?.kind}
      </p>
      <pre data-testid="sql-result">
        {JSON.stringify(query.outcome()?.rows)}
      </pre>
    </main>
  );
}
