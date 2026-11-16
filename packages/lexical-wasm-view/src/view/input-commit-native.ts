import type * as Native from '@macro-inc/collaboration/session/wasm';
import type * as CompatNative from '@macro-inc/collaboration/session/wasm-compat';
import { mintInputCommitCorrelation } from './input-commit-correlation';
import type {
  DatabaseCommitEvidence,
  InputCommitEvidence,
  InputCommitFailure,
} from './input-commit-observation';

/** Actual generated module subset. Compatibility deliberately omits the evidence exports. */
export type NativeInputCommitModule =
  | (Pick<typeof Native, 'EditorSession'> &
      Partial<Pick<typeof Native, 'InputCommitReceipt' | 'InputCommitKind'>>)
  | Pick<typeof CompatNative, 'EditorSession'>;

const apply = Reflect.apply;
const prototypeOf = Object.getPrototypeOf;

/** Numeric enum preflight; compare exactly as the later kind branches do. */
export function validInputCommitKinds(
  first: unknown,
  second: unknown
): boolean {
  return (
    typeof first === 'number' &&
    typeof second === 'number' &&
    Number.isInteger(first) &&
    Number.isInteger(second) &&
    first - second !== 0
  );
}

function getter(prototype: object, name: string) {
  const read: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.get;
  if (typeof read !== 'function')
    throw new Error(`Missing actual receipt getter ${name}`);
  return (receipt: object): unknown => apply(read, receipt, []);
}

/** Probe absent profiles without entry; capture supported wrappers only after
 * the real module guard. The dispatcher verifies each session's owner later. */
export function captureNativeInputCommit(module: NativeInputCommitModule) {
  const sessionPrototype = module.EditorSession.prototype;
  if (
    !('inputObserved' in sessionPrototype) ||
    !('readInputCommitReceipt' in sessionPrototype) ||
    !('InputCommitReceipt' in module) ||
    !('InputCommitKind' in module)
  )
    return undefined;
  const input = sessionPrototype.inputObserved;
  const read = sessionPrototype.readInputCommitReceipt;
  const Receipt = module.InputCommitReceipt;
  const Kind = module.InputCommitKind;
  if (
    typeof input !== 'function' ||
    typeof read !== 'function' ||
    typeof Receipt !== 'function' ||
    Kind === undefined
  )
    return undefined;
  const prototype = Receipt.prototype;
  const release = prototype.free;
  if (typeof release !== 'function')
    throw new Error('Missing actual receipt release');
  const entryId = getter(prototype, 'entryId');
  const mainKind = getter(prototype, 'mainKind');
  const commitId = getter(prototype, 'commitId');
  const mainHandled = getter(prototype, 'mainHandled');
  const databaseKind = getter(prototype, 'databaseKind');
  const databaseKey = getter(prototype, 'databaseKey');
  const databaseAwaitId = getter(prototype, 'databaseAwaitId');
  const notPublished = Kind.NotPublished;
  const published = Kind.Published;
  if (!validInputCommitKinds(notPublished, published))
    throw new Error('Invalid actual input commit outcome discriminants');

  function ownsReceipt(value: unknown): value is Native.InputCommitReceipt {
    return (
      typeof value === 'object' &&
      value !== null &&
      prototypeOf(value) === prototype
    );
  }
  return Object.freeze({
    invoke(
      session: Native.EditorSession,
      bytes: Uint8Array,
      now: number,
      wall: number
    ) {
      let flags: number | undefined;
      let nativeFailure: InputCommitFailure | undefined;
      const { entryId: correlation, text } =
        mintInputCommitCorrelation(session);
      try {
        const returned: unknown = apply(input, session, [
          bytes,
          now,
          wall,
          text,
        ]);
        if (typeof returned !== 'number' || returned >>> 0 !== returned)
          throw new Error('Observed native input returned invalid flags');
        flags = returned;
      } catch (error) {
        nativeFailure = { error };
      }

      let evidence: InputCommitEvidence | undefined;
      const secondary: InputCommitFailure[] = [];
      let receipt: Native.InputCommitReceipt | undefined;
      let readReturned = false;
      let owned = false;
      let released = false;
      try {
        const returned: unknown = apply(read, session, [text]);
        readReturned = true;
        if (ownsReceipt(returned)) {
          receipt = returned;
          owned = true;
        }
        if (!owned) {
          evidence = Object.freeze({
            status: 'unavailable',
            reason: 'receipt-shape',
            receiverNeverCalled: false,
          });
        } else {
          if (!receipt) throw new Error('Actual receipt was not retained');
          const actualEntry = entryId(receipt);
          const kind = mainKind(receipt);
          const commit = commitId(receipt);
          const handled = mainHandled(receipt);
          const kindValue = databaseKind(receipt);
          const keyValue = databaseKey(receipt);
          const awaitValue = databaseAwaitId(receipt);
          let database: DatabaseCommitEvidence | undefined;
          if (kindValue === 'started') {
            if (
              typeof keyValue !== 'number' ||
              !Number.isInteger(keyValue) ||
              keyValue <= 0 ||
              keyValue > 0xffffffff ||
              typeof awaitValue !== 'string' ||
              !awaitValue
            )
              throw new Error('Invalid actual Database start receipt');
            database = Object.freeze({
              kind: kindValue,
              key: keyValue,
              awaitId: awaitValue,
            });
          } else {
            if (keyValue !== undefined || awaitValue !== undefined)
              throw new Error('Unexpected actual Database start fields');
            if (
              kindValue === 'none' ||
              kindValue === 'inserted' ||
              kindValue === 'not-await' ||
              kindValue === 'removed' ||
              kindValue === 'absent' ||
              kindValue === 'invalid'
            )
              database = Object.freeze({ kind: kindValue });
            else if (kindValue !== undefined)
              throw new Error('Invalid actual Database result');
          }
          if (actualEntry !== correlation) {
            evidence = Object.freeze({
              status: 'unavailable',
              reason: 'receipt-shape',
              receiverNeverCalled: false,
            });
          } else if (
            kind === notPublished &&
            commit === undefined &&
            handled === undefined &&
            database === undefined
          ) {
            evidence = Object.freeze({
              status: 'not-published',
              entryId: correlation,
            });
          } else if (
            kind === published &&
            typeof commit === 'bigint' &&
            commit >= 0n &&
            commit <= (1n << 64n) - 1n &&
            typeof handled === 'boolean'
          ) {
            evidence = Object.freeze({
              status: 'published',
              entryId: correlation,
              commitId: commit,
              mainHandled: handled,
              ...(database ? { database } : {}),
            });
          } else {
            evidence = Object.freeze({
              status: 'unavailable',
              reason: 'receipt-shape',
              receiverNeverCalled: false,
            });
          }
        }
      } catch (error) {
        const failure = Object.freeze({ error });
        secondary.push(failure);
        evidence = Object.freeze({
          status: 'unavailable',
          reason: 'receipt-read',
          receiverNeverCalled: false,
          failure,
        });
      } finally {
        // Release the primitive owned class exactly once, including getter failure.
        // Never call a free function supplied by the returned value itself.
        if (receipt && owned) {
          try {
            apply(release, receipt, []);
            released = true;
          } catch (error) {
            secondary.push(Object.freeze({ error }));
          }
        } else if (!readReturned) {
          // No owned JS receipt reached this caller when the actual read threw.
          released = true;
        }
      }
      if (!evidence)
        throw new Error('Input commit receipt observation did not complete');
      if (evidence.status === 'unavailable' && secondary.length === 0)
        secondary.push(
          Object.freeze({
            error: new Error('Invalid actual input commit receipt'),
          })
        );
      // Known copied publication stays known if releasing its primitive lease fails.
      // Such a failure blocks notification and produces an opt-in error settlement.
      return { flags, nativeFailure, evidence, secondary, released };
    },
  });
}
