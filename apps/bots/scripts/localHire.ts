import { spawn } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Seat = { actor: string; team: string };
type Confirm = {
  kind: 'confirm';
  expectedTeam: string;
  offerId: string;
  key: string;
  name: string;
  size: string;
};
type Command =
  | Omit<Confirm, 'expectedTeam'>
  | { kind: 'offers' | 'roster' | 'fleet_pass' };
type Pending = (reply: unknown) => void;

export function localHire(
  binary: string,
  socket: string,
  role: string,
  team: string,
  actor: string
) {
  if (
    !isAbsolute(binary) ||
    !/^\/tmp\/macro-hire-local\.[a-zA-Z0-9]+$/.test(socket) ||
    !/^[a-z_][a-z0-9_]*$/.test(role) ||
    !uuid.test(team) ||
    !/^macro\|[a-z0-9-]+@example\.test$/.test(actor)
  ) {
    throw new Error('Invalid local Hire review settings');
  }

  // This helper can only see its Unix socket. No inherited credentials,
  // provider traffic, listener, or host network are available to the child.
  const child = spawn(
    'unshare',
    ['-Urn', '--', binary, socket, role, team, actor],
    {
      env: { PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'inherit'],
    }
  );
  const replies = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let pending: Pending | undefined;
  let closed = false;
  let queue = Promise.resolve();

  const unavailable = { status: 'unavailable' };
  function close() {
    if (closed) return;
    closed = true;
    pending?.(unavailable);
    pending = undefined;
    child.stdin.end();
    replies.close();
  }
  child.on('error', close);
  child.on('exit', close);
  child.stdin.on('error', close);

  replies.on('line', (line) => {
    const resolve = pending;
    pending = undefined;
    if (!resolve) {
      close();
      return;
    }
    try {
      resolve(JSON.parse(line));
    } catch {
      resolve(unavailable);
      close();
    }
  });

  function request(seat: Seat, command: Command) {
    if (seat.actor !== actor || seat.team !== team)
      return Promise.resolve({ status: 'denied' });
    const result = queue.then(
      () =>
        new Promise<unknown>((resolve) => {
          if (closed) {
            resolve(unavailable);
            return;
          }
          const timeout = setTimeout(close, 15_000);
          pending = (reply) => {
            clearTimeout(timeout);
            resolve(reply);
          };
          child.stdin.write(JSON.stringify({ ...seat, command }) + '\n');
        })
    );
    queue = result.then(() => undefined);
    return result;
  }

  return {
    team,
    request,
    close,
  };
}

export type LocalHireReview = ReturnType<typeof localHire>;

export async function readConfirm(
  req: IncomingMessage
): Promise<Confirm | undefined> {
  const size = Number(req.headers['content-length']);
  if (
    req.headers['content-type'] !== 'application/json' ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > 1024
  )
    return;

  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > size) return;
  }
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 5)
    return;
  if (
    'expectedTeam' in value &&
    typeof value.expectedTeam === 'string' &&
    uuid.test(value.expectedTeam) &&
    'offerId' in value &&
    typeof value.offerId === 'string' &&
    uuid.test(value.offerId) &&
    'key' in value &&
    typeof value.key === 'string' &&
    uuid.test(value.key) &&
    'name' in value &&
    typeof value.name === 'string' &&
    [...value.name.trim()].length >= 1 &&
    [...value.name.trim()].length <= 64 &&
    'size' in value &&
    typeof value.size === 'string' &&
    ['standard', 'large', 'xl'].includes(value.size)
  ) {
    return {
      kind: 'confirm',
      expectedTeam: value.expectedTeam,
      offerId: value.offerId,
      key: value.key,
      name: value.name.trim(),
      size: value.size,
    };
  }
}
