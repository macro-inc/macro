/**
 * Who is driving the agent's screen: nobody but the agent, its owner (a
 * take-over from Macro's screen view), or the CAPTCHA solver. One driver at
 * a time: the browser's own steps refuse while someone else drives, and the
 * solver doesn't start while the owner does.
 *
 * The owner's take-over is the harness's advisory file
 * (`$HOME/state/screen-driver`, `human:<userId>`); the harness itself also
 * holds the agent's brain calls until hand-back. The solver's lease is a
 * file of the agent's own, made exclusively, so two solves never overlap.
 */
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Driver =
  | { readonly kind: 'agent' }
  | { readonly kind: 'owner' }
  | { readonly kind: 'solver'; readonly solveId: string };

/** A solver lease older than this is from a solve that died: it is taken over. */
export const staleLeaseMs = 4 * 60_000;

type Lease = { readonly solveId: string; readonly since: number };

/** The owner's take-over, from the advisory file's contents. */
export const ownerDriving = (advisory: string | undefined): boolean =>
  advisory !== undefined && advisory.trim().startsWith('human:');

const parseLease = (text: string | undefined): Lease | undefined => {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === 'object' &&
      value !== null &&
      'solveId' in value &&
      'since' in value &&
      typeof value.solveId === 'string' &&
      typeof value.since === 'number'
    )
      return { solveId: value.solveId, since: value.since };
  } catch {
    return undefined;
  }
  return undefined;
};

/** Who drives, from the two files: the owner first, then a live solver lease. */
export const driverOf = (
  advisory: string | undefined,
  lease: string | undefined,
  now: number
): Driver => {
  if (ownerDriving(advisory)) return { kind: 'owner' };
  const held = parseLease(lease);
  if (held === undefined || now - held.since > staleLeaseMs)
    return { kind: 'agent' };
  return { kind: 'solver', solveId: held.solveId };
};

/** Why a browser step won't run, or undefined if it may. */
export const refusal = (driver: Driver): string | undefined => {
  if (driver.kind === 'owner')
    return 'your owner is driving your screen: wait until they hand it back';
  if (driver.kind === 'solver')
    return 'the CAPTCHA solver is using your browser: wait for solveCaptcha to finish';
  return undefined;
};

export type DriverPorts = {
  readonly driver: () => Promise<Driver>;
  /** Takes the solver lease for `solveId`; false if someone else drives. */
  readonly acquire: (solveId: string) => Promise<boolean>;
  /** Gives the lease back, if `solveId` still holds it. */
  readonly release: (solveId: string) => Promise<void>;
};

const readOrMissing = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf8').catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return undefined;
    throw error;
  });

/** The real files. */
export const driverPorts = ({
  advisory,
  lease,
  now,
}: {
  /** The harness's take-over file. */
  readonly advisory: string;
  /** The solver's lease file. */
  readonly lease: string;
  readonly now: () => number;
}): DriverPorts => {
  const driver = async () =>
    driverOf(await readOrMissing(advisory), await readOrMissing(lease), now());

  const create = async (solveId: string): Promise<boolean> => {
    await mkdir(dirname(lease), { recursive: true });
    try {
      // `wx`: made only if absent, so of two solves starting at once one wins.
      const file = await open(lease, 'wx');
      await file.writeFile(JSON.stringify({ solveId, since: now() }));
      await file.close();
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      )
        return false;
      throw error;
    }
  };

  return {
    driver,
    acquire: async (solveId) => {
      const current = await driver();
      if (current.kind !== 'agent') return false;
      if (await create(solveId)) return true;
      // The file is there but dead (stale or unreadable): clear it and try once more.
      await rm(lease, { force: true });
      return create(solveId);
    },
    release: async (solveId) => {
      const held = parseLease(await readOrMissing(lease));
      if (held?.solveId === solveId) await rm(lease, { force: true });
    },
  };
};
