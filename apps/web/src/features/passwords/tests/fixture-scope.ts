import type {
  ImportResume,
  ImportResumeStore,
  PasswordCapabilities,
  PasswordScope,
} from '../context/passwords-context';

/** A viewer scope a test can end, as a sign-in to another account would. */
export function createFixtureScope(key = 'fixture-account:1:fixture-team') {
  let current = true;
  const scope: PasswordScope = { key, isCurrent: () => current };
  return {
    scope,
    end() {
      current = false;
    },
  };
}

export const FIXTURE_SCOPE = createFixtureScope().scope;

/** Unfinished imports kept in memory, as sessionStorage keeps them in a tab. */
export function createMemoryImportResume(): ImportResumeStore & {
  /** What is stored, for assertions. */
  stored(): ImportResume[];
} {
  const entries = new Map<string, ImportResume>();
  return {
    stored: () => [...entries.values()],
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

/** Import capabilities for tests that never import. */
export function noImport(): Pick<
  PasswordCapabilities,
  'parseExport' | 'importResume'
> {
  return {
    parseExport: async () => ({ outcome: 'unreadable' }),
    importResume: createMemoryImportResume(),
  };
}
