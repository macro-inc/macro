import { formatLocale, t } from '@app/lib/i18n';
import type {
  ImportFormat,
  ParsedImport,
  ParsedImportItem,
} from '@core/password-import/types';
import { sleep } from '@core/util/sleep';
import { type Span, Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import {
  type ImportBatchBody,
  type ImportBatchResult,
  type ImportDestination,
  type ImportErrorCode,
  type ImportFileFailure,
  type ImportPreview,
  type ImportResume,
  type PasswordSource,
  usePasswords,
} from '../context/passwords-context';
import {
  candidateNames,
  checkFolders,
  chunkNames,
  duplicateKeys,
  foldersFor,
  type ImportFailureReason,
  type ImportTally,
  type ImportTarget,
  MATCH_BYTES,
  MATCH_NAMES,
  planBatches,
  uniqueRootFolderName,
  VAULT_LIST_CAP,
} from '../core/import';
import type { PasswordFolder, PasswordItem } from '../core/types';

export type ImportStep =
  | { step: 'choose'; failure?: ImportFileFailure }
  | { step: 'parsing' }
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'importing'; done: number; total: number }
  | {
      step: 'result';
      tally: ImportTally;
      /** The folder the items went into; null for the vault root. */
      targetFolderId: string | null;
      /** The request itself failed before every item had an answer. */
      interrupted: boolean;
    };

/** Request-level retries per batch, past the source's own busy retries. */
const BATCH_ATTEMPTS = 3;
/** Rounds of resending items the vault answered busy or unavailable for. */
const ITEM_RETRY_ROUNDS = 3;
const RETRY_BACKOFF_MS = 500;

const SOURCE_NAMES: Record<ImportFormat, string> = {
  one_password_pux: '1Password',
  one_password_csv: '1Password',
  bitwarden_json: 'Bitwarden',
  bitwarden_csv: 'Bitwarden',
};

/**
 * sessionStorage key for an import of this file by this viewer: a hash of the
 * viewer and the file's contents, so an edited file is a new import.
 */
async function resumeKey(scopeKey: string, fileHash: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${scopeKey}\u0000${fileHash}`)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function importFolderName(format: ImportFormat, startedAt: Date) {
  return t('passwords.importFolderName', {
    source: SOURCE_NAMES[format],
    date: new Intl.DateTimeFormat(formatLocale(), {
      dateStyle: 'medium',
    }).format(startedAt),
  });
}

type ImportRun = {
  importId: string;
  format: ImportFormat;
  target: ImportTarget;
  private: boolean;
  items: ParsedImportItem[];
  folders: ParsedImport['folders'];
};

type RunOutcome = {
  created: number;
  alreadyPresent: number;
  failed: number;
  failures: Partial<Record<ImportFailureReason, number>>;
  targetFolderId: string | null;
  interrupted: boolean;
};

/** Why the vault failed one item, as the result screen groups it. */
function itemFailureReason(
  code: ImportErrorCode | undefined
): ImportFailureReason {
  return match(code)
    .with('busy', () => 'busy' as const)
    .with('vault_unavailable', undefined, () => 'server_error' as const)
    .with('folder_missing', () => 'folder_missing' as const)
    .with('invalid_request', () => 'invalid' as const)
    .with('not_found', 'forbidden', 'version_conflict', () => 'refused' as const)
    .exhaustive(() => 'server_error' as const);
}

/**
 * Item failures worth sending again: the vault was busy or briefly
 * unavailable, or a folder was deleted after the batch ensured it (the resend
 * ensures it again).
 */
function isRetryable(code: ImportErrorCode | undefined) {
  return match(code)
    .with('busy', 'vault_unavailable', 'folder_missing', () => true)
    .with(
      'not_found',
      'forbidden',
      'invalid_request',
      'version_conflict',
      undefined,
      () => false
    )
    .exhaustive(() => false);
}

/**
 * Sends `run` one batch at a time. A batch whose request fails for want of
 * an answer, a busy vault or a server error is sent again; a rejected one is
 * not. Items answered busy, unavailable or folder missing go into a later
 * round, after a wait. Item ids derive from the
 * import id and source key on the server, so a resent item is never doubled.
 */
export async function sendImport(
  source: Pick<PasswordSource, 'importBatch'>,
  run: ImportRun,
  options: {
    span: Span;
    onProgress: (done: number) => void;
    /** Each batch's items just before it is sent, for resuming. */
    onSending?: (items: ParsedImportItem[]) => void;
    /** Each batch's per-item answers (outcomes and ids, never values), for resuming. */
    onAnswered?: (answers: ImportBatchResult['items']) => void;
    wait?: (ms: number) => Promise<void>;
  }
): Promise<RunOutcome> {
  const wait = options.wait ?? sleep;
  const outcome: RunOutcome = {
    created: 0,
    alreadyPresent: 0,
    failed: 0,
    failures: {},
    targetFolderId: null,
    interrupted: false,
  };
  const fail = (reason: ImportFailureReason, count = 1) => {
    outcome.failed += count;
    outcome.failures[reason] = (outcome.failures[reason] ?? 0) + count;
  };
  let target = run.target;
  let pending = run.items;
  let batches = 0;
  for (let round = 0; pending.length > 0; round++) {
    if (round > 0) await wait(RETRY_BACKOFF_MS * 2 ** (round - 1));
    const retry: ParsedImportItem[] = [];
    for (const items of planBatches(pending, run.folders)) {
      const body: ImportBatchBody = {
        format: run.format,
        target,
        private: run.private,
        folders: foldersFor(items, run.folders),
        items,
      };
      options.onSending?.(items);
      let result = await options.span.run(() =>
        source.importBatch(run.importId, body)
      );
      for (
        let attempt = 1;
        result.isErr() &&
        result.error.retryable &&
        attempt < BATCH_ATTEMPTS;
        attempt++
      ) {
        await wait(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
        result = await options.span.run(() =>
          source.importBatch(run.importId, body)
        );
      }
      batches++;
      if (result.isErr()) {
        // Folder-phase and request failures fail the whole batch.
        fail(result.error.reason, items.length);
        outcome.interrupted = true;
        options.onProgress(
          outcome.created + outcome.alreadyPresent + outcome.failed
        );
        continue;
      }
      outcome.targetFolderId = result.value.targetFolderId;
      // Later batches reuse the folder the first one ensured.
      if (target.kind === 'new' && result.value.targetFolderId)
        target = { kind: 'existing', folderId: result.value.targetFolderId };
      options.onAnswered?.(result.value.items);
      const bySource = new Map(items.map((item) => [item.sourceKey, item]));
      for (const answer of result.value.items) {
        const item = bySource.get(answer.sourceKey);
        if (!item) continue;
        bySource.delete(answer.sourceKey);
        match(answer.outcome)
          .with('created', () => {
            outcome.created++;
          })
          .with('already_present', () => {
            outcome.alreadyPresent++;
          })
          .with('failed', () => {
            if (isRetryable(answer.errorCode) && round + 1 < ITEM_RETRY_ROUNDS)
              retry.push(item);
            else fail(itemFailureReason(answer.errorCode));
          })
          .exhaustive(() => {
            fail('no_answer');
          });
      }
      // An item the server did not answer for is unknown: count it failed.
      if (bySource.size > 0) fail('no_answer', bySource.size);
      options.onProgress(
        outcome.created + outcome.alreadyPresent + outcome.failed
      );
    }
    pending = retry;
  }
  options.span.setAttr('passwords.import.batches', batches);
  return outcome;
}

/**
 * The import dialog's state: parse a file in the browser, preview it, then
 * send it in batches. The parsed export lives only in this closure while the
 * dialog is open: never in a query cache, the store, or browser storage.
 */
export function createPasswordImport(props: {
  /** The vault list; undefined while it is unavailable. */
  items: () => PasswordItem[] | undefined;
  folders: () => PasswordFolder[];
  refresh: () => Promise<void>;
}) {
  const { scope, source, parseExport, importResume } = usePasswords();
  const [state, setState] = createStore<{ current: ImportStep }>({
    current: { step: 'choose' },
  });
  const [skipDuplicates, setSkipDuplicates] = createSignal(true);
  const [destination, setDestination] = createSignal<ImportDestination>('new');
  const [makePrivate, setMakePrivate] = createSignal(false);
  let parsed: ParsedImport | undefined;
  let duplicates = new Set<string>();
  let resume: { key: string; entry: ImportResume } | undefined;
  let generation = 0;

  const step = () => state.current;
  const setStep = (next: ImportStep) => setState('current', next);

  const target = (): ImportTarget => {
    const current = state.current;
    if (current.step !== 'preview') return { kind: 'root' };
    return match(destination())
      .with(
        'new',
        (): ImportTarget => ({
          kind: 'new',
          name: current.preview.newFolderName,
        })
      )
      .with('root', (): ImportTarget => ({ kind: 'root' }))
      .otherwise(
        (value): ImportTarget => ({
          kind: 'existing',
          folderId: value.slice('folder:'.length),
        })
      );
  };
  const folderCheck = () => {
    const current = state.current;
    if (current.step !== 'preview') return undefined;
    // Only the folders the items being sent use.
    const needed = new Set(
      foldersFor(toSend(), current.preview.folders).map((folder) => folder.key)
    );
    const check = checkFolders(
      target(),
      current.preview.folders.filter((folder) => needed.has(folder.key)),
      props.folders()
    );
    // A continued import's folders may already exist, so counting them again
    // would refuse it; the vault enforces its folder cap on each batch.
    return current.preview.resumed ? { ...check, tooMany: false } : check;
  };
  const toSend = () => {
    if (!parsed) return [];
    if (!skipDuplicates()) return parsed.items;
    return parsed.items.filter((item) => !duplicates.has(item.sourceKey));
  };

  /**
   * Vault metadata to match duplicates against. The list stops at 500 items;
   * past that, the export's distinct names are matched in the vault (metadata
   * only), in requests of at most `MATCH_NAMES` names and `MATCH_BYTES` sent
   * in the body.
   */
  async function knownItems(items: ParsedImportItem[]) {
    const available = props.items();
    if (available && available.length < VAULT_LIST_CAP)
      return { items: available, partial: false };
    // A capped or unavailable list: match every name in the vault itself.
    const loaded = available ?? [];
    const names = candidateNames(items);
    const found = new Map(loaded.map((item) => [item.id, item]));
    let partial = false;
    await Telemetry.span('passwords.import.duplicates', async (span) => {
      span.setAttr('passwords.import.names', names.length);
      let requests = 0;
      for (const chunk of chunkNames(names, MATCH_NAMES, MATCH_BYTES)) {
        requests++;
        const result = await span.run(() => source.matchNames(chunk));
        if (result.isErr()) {
          partial = true;
          continue;
        }
        // A capped answer may leave out a match.
        if (result.value.length >= MATCH_NAMES) partial = true;
        for (const item of result.value) found.set(item.id, item);
      }
      span.setAttr('passwords.import.requests', requests);
      span.setAttr('passwords.import.partial', partial);
    });
    return { items: [...found.values()], partial };
  }

  /**
   * Reads `file` into a preview. Never rejects: a failure anywhere (the
   * parser module failing to load, for one) returns to the file picker.
   */
  async function choose(file: File) {
    const run = generation + 1;
    const read = await ResultAsync.fromPromise(readFile(file), () => 'failed');
    if (read.isErr() && run === generation)
      setStep({ step: 'choose', failure: { code: 'unreadable' } });
  }

  async function readFile(file: File) {
    const run = ++generation;
    setStep({ step: 'parsing' });
    const reply = await Telemetry.span(
      'passwords.import.parse',
      async (span) => {
        const answer = await parseExport(file);
        span.setAttr('passwords.import.outcome', answer.outcome);
        if (answer.outcome === 'parsed') {
          span.setAttr('passwords.import.format', answer.export.format);
          span.setAttr('passwords.import.items', answer.export.items.length);
          span.setAttr(
            'passwords.import.skipped',
            answer.export.skipped.length
          );
          span.setAttr(
            'passwords.import.folders',
            answer.export.folders.length
          );
        }
        if (answer.outcome === 'failed')
          span.setAttr('passwords.import.error', answer.error.code);
        return answer;
      }
    );
    if (run !== generation || !scope.isCurrent()) return;
    if (reply.outcome !== 'parsed') {
      setStep({
        step: 'choose',
        failure:
          reply.outcome === 'failed' ? reply.error : { code: 'unreadable' },
      });
      return;
    }
    parsed = reply.export;
    const key = await resumeKey(scope.key, reply.fileHash);
    if (run !== generation) return;
    const stored = importResume.get(key);
    // A continued import is locked to its folder; if that folder is gone,
    // start a new import rather than one that can only fail.
    const folderGone =
      stored !== undefined && !destinationExists(stored.destination);
    if (folderGone) importResume.remove(key);
    const earlier =
      !folderGone && stored?.format === parsed.format ? stored : undefined;
    const known = await knownItems(parsed.items);
    if (run !== generation || !scope.isCurrent()) return;
    duplicates = duplicateKeys(parsed.items, known.items);
    // Items an earlier run created but could not finish are resent, never
    // skipped: the vault answers already present and finishes them.
    for (const sourceKey of Object.keys(earlier?.unfinished ?? {}))
      duplicates.delete(sourceKey);
    const entry: ImportResume = earlier ?? {
      importId: uuidv7(),
      format: parsed.format,
      startedAt: new Date().toISOString(),
      destination: 'new',
      private: false,
      unfinished: {},
    };
    // A continued import keeps the destination and privacy it started with.
    setDestination(entry.destination);
    setMakePrivate(entry.private);
    resume = { key, entry };
    setStep({
      step: 'preview',
      preview: {
        format: parsed.format,
        summary: parsed.summary,
        itemCount: parsed.items.length,
        folders: parsed.folders,
        skipped: parsed.skipped,
        dropped: parsed.dropped,
        duplicates: duplicates.size,
        duplicatesPartial: known.partial,
        resumed: entry === earlier,
        restarted: folderGone,
        newFolderName: newFolderName(
          importFolderName(parsed.format, new Date(entry.startedAt)),
          entry === earlier
        ),
      },
    });
  }

  /** Whether a stored destination still exists: the root, a new folder, or a live folder. */
  function destinationExists(stored: ImportDestination) {
    if (!stored.startsWith('folder:')) return true;
    const id = stored.slice('folder:'.length);
    return props.folders().some((folder) => folder.id === id);
  }

  /**
   * A resumed import reuses the folder its first run made (the server keys it
   * by import id), so only a fresh import avoids names already in use.
   */
  function newFolderName(base: string, resumed: boolean) {
    if (resumed) return base;
    return uniqueRootFolderName(base, props.folders(), (number) =>
      t('passwords.importFolderNameNumbered', { name: base, number })
    );
  }

  async function start() {
    const current = state.current;
    const check = folderCheck();
    if (current.step !== 'preview' || !parsed || !resume) return;
    if (check?.tooMany || check?.tooDeep) return;
    const run = generation;
    const items = toSend();
    const left = parsed.items.length - items.length;
    const parserSkipped = current.preview.skipped.length;
    // Read while the preview is current: the target is derived from it.
    const chosenTarget = target();
    const folders = parsed.folders;
    const { key } = resume;
    const unfinished = new Map(Object.entries(resume.entry.unfinished));
    const entry: ImportResume = {
      ...resume.entry,
      destination: destination(),
      private: makePrivate(),
    };
    // Ids only: lets a rerun with the same file continue this import.
    const remember = () =>
      importResume.set(key, {
        ...entry,
        unfinished: Object.fromEntries(unfinished),
      });
    remember();
    setStep({ step: 'importing', done: 0, total: items.length });
    const outcome = await Telemetry.span('passwords.import', async (span) => {
      span.setAttr('passwords.import.id', entry.importId);
      span.setAttr('passwords.import.format', entry.format);
      span.setAttr('passwords.import.items', items.length);
      span.setAttr('passwords.import.target', chosenTarget.kind);
      const result = await sendImport(
        source,
        {
          importId: entry.importId,
          format: entry.format,
          target: chosenTarget,
          private: makePrivate(),
          items,
          folders,
        },
        {
          span,
          onProgress: (done) => {
            if (run === generation)
              setStep({ step: 'importing', done, total: items.length });
          },
          onSending: (batch) => {
            // An item with a verification code may be created while its code
            // is not: until an answer says otherwise, a rerun must resend it.
            let changed = false;
            for (const item of batch) {
              if (item.totp !== null && !unfinished.has(item.sourceKey)) {
                unfinished.set(item.sourceKey, null);
                changed = true;
              }
            }
            if (changed) remember();
          },
          onAnswered: (answers) => {
            // Written only when an item starts or stops needing a rerun.
            let changed = false;
            for (const answer of answers) {
              if (answer.outcome === 'failed' && answer.itemId) {
                if (unfinished.get(answer.sourceKey) !== answer.itemId) {
                  unfinished.set(answer.sourceKey, answer.itemId);
                  changed = true;
                }
              } else if (answer.outcome !== 'failed') {
                // Evaluated first: every finished key is removed.
                if (unfinished.delete(answer.sourceKey)) changed = true;
              }
            }
            if (changed) remember();
          },
        }
      );
      span.setAttr('passwords.import.created', result.created);
      span.setAttr('passwords.import.already_present', result.alreadyPresent);
      span.setAttr('passwords.import.failed', result.failed);
      if (result.failed > 0) span.error('passwords.import incomplete');
      return result;
    });
    if (outcome.failed === 0) importResume.remove(key);
    await props.refresh();
    if (run !== generation) return;
    parsed = undefined;
    duplicates = new Set();
    setStep({
      step: 'result',
      tally: {
        created: outcome.created,
        alreadyPresent: outcome.alreadyPresent,
        skipped: left + parserSkipped,
        failed: outcome.failed,
        failures: outcome.failures,
      },
      targetFolderId: outcome.targetFolderId,
      interrupted: outcome.interrupted,
    });
  }

  /** Back to choosing a file; drops the parsed export. */
  function reset() {
    generation++;
    parsed = undefined;
    duplicates = new Set();
    resume = undefined;
    setStep({ step: 'choose' });
  }

  const current = <Step extends ImportStep['step']>(name: Step) => {
    const value = state.current;
    return value.step === name
      ? (value as Extract<ImportStep, { step: Step }>)
      : undefined;
  };

  return {
    step,
    chooseFailure: () => current('choose')?.failure,
    preview: () => current('preview')?.preview,
    progress: () => current('importing'),
    result: () => current('result'),
    choose,
    start,
    reset,
    /** Drops the parsed export; an import in flight still finishes. */
    close: () => {
      parsed = undefined;
      duplicates = new Set();
    },
    skipDuplicates,
    setSkipDuplicates,
    destination,
    setDestination,
    makePrivate,
    setMakePrivate,
    folderCheck,
    sendCount: () => {
      const current = state.current;
      if (current.step !== 'preview') return 0;
      return skipDuplicates()
        ? current.preview.itemCount - current.preview.duplicates
        : current.preview.itemCount;
    },
  };
}
export type PasswordImportController = ReturnType<typeof createPasswordImport>;
