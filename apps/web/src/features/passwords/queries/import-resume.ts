import { z } from 'zod';
import type {
  ImportResume,
  ImportResumeStore,
} from '../context/passwords-context';

const PREFIX = 'macro.passwords.import:';

const RESUME_SCHEMA = z.object({
  importId: z.uuid(),
  format: z.enum([
    'one_password_pux',
    'one_password_csv',
    'bitwarden_json',
    'bitwarden_csv',
  ]),
  startedAt: z.iso.datetime(),
  destination: z.union([
    z.literal('new'),
    z.literal('root'),
    z.templateLiteral(['folder:', z.uuid()]),
  ]),
  private: z.boolean(),
  itemIds: z.array(z.uuid()).max(20_000),
});

/**
 * Unfinished imports in this tab's sessionStorage, keyed by a hash of the
 * viewer and the file's contents. Holds the import id, format, start time,
 * destination, privacy and the ids of items it created: never names, values
 * or anything from the file.
 */
export function createSessionImportResume(): ImportResumeStore {
  return {
    get(key) {
      try {
        const raw = sessionStorage.getItem(PREFIX + key);
        if (!raw) return undefined;
        const parsed = RESUME_SCHEMA.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    set(key, value: ImportResume) {
      try {
        sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        // Without storage a rerun of this file starts a new import.
      }
    },
    remove(key) {
      try {
        sessionStorage.removeItem(PREFIX + key);
      } catch {
        // Nothing stored to remove.
      }
    },
  };
}
