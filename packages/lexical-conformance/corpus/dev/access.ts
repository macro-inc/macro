import { execFileSync } from 'node:child_process';

export function devSecret(
  key: 'DATABASE_URL' | 'SYNC_SERVICE_AUTH_KEY'
): string {
  try {
    return execFileSync(
      'doppler',
      [
        'secrets',
        'get',
        key,
        '--project',
        'cloud-storage-service',
        '--config',
        'dev',
        '--plain',
        '--no-check-version',
        '--attempts',
        '1',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
    ).trim();
  } catch {
    throw new Error(
      `Dev Doppler access required: cloud-storage-service/dev ${key}`
    );
  }
}

export function database() {
  const url = new URL(devSecret('DATABASE_URL'));
  if (
    !url.hostname.includes('dev') ||
    !['postgres:', 'postgresql:'].includes(url.protocol)
  )
    throw new Error('Refusing non-dev database');
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000',
    PGCONNECT_TIMEOUT: '10',
  };
  return (query: string, cursor: string): unknown[] => {
    try {
      const data = execFileSync(
        'psql',
        ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', `cursor=${cursor}`],
        {
          env,
          input: `BEGIN READ ONLY;\n${query}\nROLLBACK;`,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 40000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      return data.trim()
        ? data
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [];
    } catch {
      throw new Error('Dev database read failed (details suppressed)');
    }
  };
}

export const syncUrl = 'https://sync-service-dev3.macroverse.workers.dev';
