import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Sdk } from '@macro-inc/sdk/generated/auth';
import type { Plugin } from 'vite';
import { parseComputerUsage } from '../src/billing/local-read';
import type { HireAccess } from '../src/hire-access';

const defaultUpstream = 'http://127.0.0.1:23011/auth';
const billingUpstream = 'http://127.0.0.1:23211/auth';
const billingTeamId = '0193a1b2-0000-7000-8000-0000000000aa';
const reviewer = 'macrobots-reviewer@example.test';
const fixtureTeam = 'Macro Bots Local Review';
const cookieName = 'bots-local-session';
const lifetime = 10 * 60 * 1000;

type Session = { expires: number; token?: string };
type Viewer = Pick<
  Extract<HireAccess, { status: 'signed-in' }>,
  'status' | 'teamId' | 'role'
>;
type Identity = Viewer | Exclude<HireAccess, { status: 'signed-in' }>;

export function localAuth(path: string, billing = false): Plugin {
  const upstream = billing ? billingUpstream : defaultUpstream;
  const sdk = new Sdk();
  const sessions = new Map<string, Session>();
  let exchanging = false;
  const cookie = `${cookieName}=$ID; Path=${path}; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime / 1000}`;

  return {
    name: 'bots-local-auth',
    apply: 'serve',
    configResolved(config) {
      if (
        config.server.host !== '127.0.0.1' ||
        config.server.port !== 0 ||
        config.server.cors !== false
      ) {
        throw new Error(
          'Bots local auth requires an ephemeral loopback server'
        );
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const address = server.httpServer?.address();
        const host =
          typeof address === 'object' && address?.address === '127.0.0.1'
            ? `127.0.0.1:${address.port}`
            : undefined;
        if (!host || req.headers.host !== host) {
          send(res, 403, { status: 'unavailable' });
          return;
        }
        if (!req.url?.startsWith(path)) {
          const page = req.url?.split('?')[0];
          if (
            req.method === 'GET' &&
            req.headers.accept?.includes('text/html') &&
            ['/', '/sign-in', '/fleet', '/passwords', '/billing'].some(
              (route) => route === page
            )
          ) {
            req.url = '/index.html';
          }
          next();
          return;
        }
        void handle(req, res, `http://${host}`).catch(() =>
          send(res, 503, { status: 'unavailable' })
        );
      });
    },
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    origin: string
  ) {
    if (
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] !== undefined &&
        req.headers['sec-fetch-site'] !== 'same-origin') ||
      (req.method === 'POST' && req.headers.origin !== origin)
    ) {
      send(res, 403, { status: 'unavailable' });
      return;
    }
    for (const [id, session] of sessions) {
      if (session.expires <= Date.now()) sessions.delete(id);
    }

    const id = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const session = id ? sessions.get(id) : undefined;
    const current = () =>
      id !== undefined &&
      session !== undefined &&
      sessions.get(id) === session &&
      session.expires > Date.now();
    const options = {
      baseUrl: upstream,
      redirect: 'error' as const,
      signal: AbortSignal.timeout(10_000),
    };

    if (req.method === 'GET' && req.url === path) {
      const viewer = session?.token
        ? await identity(session.token, billing ? current : undefined)
        : undefined;
      send(
        res,
        200,
        viewer?.status === 'signed-in'
          ? {
              status: 'signed-in',
              team: { id: viewer.teamId, name: fixtureTeam },
            }
          : { status: viewer?.status ?? 'signed-out' }
      );
      return;
    }

    if (
      billing &&
      req.method === 'GET' &&
      req.url === `${path}/compute-usage`
    ) {
      const contentLength = req.headers['content-length'];
      if (
        req.headers['transfer-encoding'] ||
        (contentLength && contentLength !== '0')
      ) {
        send(res, 400, { status: 'unavailable' });
        return;
      }

      if (!id || !session?.token) {
        send(res, 401, { status: 'signed-out' });
        return;
      }

      const prepared = await identity(session.token, current);
      if (prepared.status !== 'signed-in') {
        if (prepared.status === 'signed-out') send(res, 401, prepared);
        else if (prepared.status === 'team-unresolved')
          send(res, 403, { status: 'denied' });
        else send(res, 503, { status: 'unavailable' });
        return;
      }

      const observation = await sdk.listTeamComputerUsage(
        signedOptions(session.token)
      );
      if (!current()) {
        send(res, 401, { status: 'signed-out' });
        return;
      }
      if (
        observation.response?.status === 401 ||
        observation.response?.status === 403
      ) {
        send(res, observation.response.status, { status: 'denied' });
        return;
      }

      const verified = await identity(session.token, current);
      if (verified.status === 'signed-out') {
        send(res, 401, verified);
        return;
      }
      if (verified.status === 'unavailable') {
        send(res, 503, verified);
        return;
      }
      if (
        verified.status !== 'signed-in' ||
        verified.teamId !== prepared.teamId ||
        verified.role !== prepared.role
      ) {
        send(res, 403, { status: 'denied' });
        return;
      }

      const value = parseComputerUsage(observation.data);
      if (observation.response?.status !== 200 || !value) {
        send(res, 503, { status: 'unavailable' });
        return;
      }

      send(res, 200, { status: 'ready', teamId: verified.teamId, value });
      return;
    }

    if (!billing && req.method === 'GET' && req.url === `${path}/hire-access`) {
      if (!id || !session?.token) {
        send(res, 401, { status: 'signed-out' });
        return;
      }
      const access = await hireAccess(session.token);
      if (sessions.get(id) !== session || session.expires <= Date.now()) {
        send(res, 401, { status: 'signed-out' });
        return;
      }
      send(res, 200, access);
      return;
    }

    if (
      req.method !== 'POST' ||
      ![`${path}/begin`, `${path}/complete`].includes(req.url ?? '')
    ) {
      send(res, 404, { status: 'unavailable' });
      return;
    }
    if (exchanging) {
      send(res, 409, { status: 'unavailable' });
      return;
    }
    exchanging = true;
    try {
      await exchange(req, res, origin, id, session, options);
    } finally {
      exchanging = false;
    }
  }

  async function exchange(
    req: IncomingMessage,
    res: ServerResponse,
    origin: string,
    id: string | undefined,
    session: Session | undefined,
    options: { baseUrl: string; redirect: 'error'; signal: AbortSignal }
  ) {
    if (req.url === `${path}/begin`) {
      if (sessions.size >= 64) {
        send(res, 429, { status: 'unavailable' });
        return;
      }
      for (const [pendingId, pending] of sessions) {
        if (!pending.token) sessions.delete(pendingId);
      }
      const response = await sdk.passwordlessLogin({
        ...options,
        body: { email: reviewer, redirect_uri: origin },
      });
      if (response.response?.status !== 200) {
        send(res, 503, { status: 'unavailable' });
        return;
      }
      if (id) sessions.delete(id);
      issue(res, {});
      send(res, 200, { status: 'code-sent' });
      return;
    }

    if (req.method === 'POST' && req.url === `${path}/complete`) {
      if (!id || !session || session.token) {
        send(res, 401, { status: 'rejected' });
        return;
      }
      const code = await readCode(req);
      if (!code || sessions.get(id) !== session) {
        send(res, 400, { status: 'rejected' });
        return;
      }
      // Consume the browser challenge before exchanging the one-time code.
      sessions.delete(id);
      // The handler supports disable_redirect even though its OpenAPI query
      // schema only exposes email. The tokens are used exclusively here.
      const query = { email: reviewer, disable_redirect: 'true' };
      const response = await sdk.passwordlessCallback({
        ...options,
        path: { code },
        query,
      });
      if (response.response?.status !== 200 || !response.data?.access_token) {
        send(res, 401, { status: 'rejected' });
        return;
      }
      const token = response.data.access_token;
      const result = await identity(token);
      if (result.status === 'signed-in') issue(res, { token });
      send(res, 200, { status: result.status });
      return;
    }

    send(res, 404, { status: 'unavailable' });
  }

  function issue(res: ServerResponse, session: Pick<Session, 'token'>) {
    const id = randomUUID();
    sessions.set(id, { ...session, expires: Date.now() + lifetime });
    res.setHeader('Set-Cookie', cookie.replace('$ID', id));
  }

  function signedOptions(token: string) {
    return {
      baseUrl: upstream,
      redirect: 'error' as const,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    };
  }

  async function identity(
    token: string,
    current?: () => boolean
  ): Promise<Identity> {
    if (current && !current()) return { status: 'signed-out' };
    const options = signedOptions(token);
    const user = await sdk.getUserInfo(options);
    if (current && !current()) return { status: 'signed-out' };
    if (user.response?.status === 401) return { status: 'signed-out' };
    if (
      user.response?.status !== 200 ||
      user.data?.user_id !== `macro|${reviewer}`
    ) {
      return { status: 'unavailable' };
    }
    const team = await sdk.getTeam(options);
    if (current && !current()) return { status: 'signed-out' };
    if (team.response?.status === 401) return { status: 'signed-out' };
    if (team.response?.status === 204) return { status: 'team-unresolved' };
    if (team.response?.status !== 200 || !team.data) {
      return { status: 'unavailable' };
    }
    const member = team.data.members.find(
      (member) =>
        member.user_id === user.data?.user_id &&
        member.team_id === team.data?.team.id
    );
    if (
      !member ||
      team.data.team.name !== fixtureTeam ||
      (billing && team.data.team.id !== billingTeamId)
    ) {
      return { status: 'team-unresolved' };
    }
    return {
      status: 'signed-in',
      teamId: team.data.team.id,
      role: member.role,
    };
  }

  async function hireAccess(token: string): Promise<HireAccess> {
    const viewer = await identity(token);
    if (viewer.status !== 'signed-in') return viewer;

    const options = signedOptions(token);
    const [rollout, agents] = await Promise.all([
      sdk.getTeamComputerRollout(options),
      sdk.listTeamAgents(options),
    ]);
    if (rollout.response?.status === 401 || agents.response?.status === 401) {
      return { status: 'signed-out' };
    }

    const confirmed = await identity(token);
    if (confirmed.status !== 'signed-in') return confirmed;
    if (confirmed.teamId !== viewer.teamId || confirmed.role !== viewer.role) {
      return { status: 'team-unresolved' };
    }

    const computerRollout =
      rollout.response?.status === 200 &&
      typeof rollout.data?.enabled === 'boolean'
        ? rollout.data.enabled
          ? 'on'
          : 'off'
        : 'unknown';
    const roster: Extract<HireAccess, { status: 'signed-in' }>['roster'] =
      agents.response?.status === 403
        ? { status: 'denied' }
        : { status: 'unavailable' };
    const entries = agents.data?.agents;
    const verifiedRoster =
      agents.response?.status === 200 &&
      Array.isArray(entries) &&
      entries.every((agent) => agent.teamId === viewer.teamId) &&
      new Set(entries.map((agent) => agent.userId)).size === entries.length
        ? { status: 'ready' as const, count: entries.length }
        : roster;
    let eligibility: Extract<
      HireAccess,
      { status: 'signed-in' }
    >['eligibility'] = 'unavailable';
    if (
      viewer.role === 'member' ||
      computerRollout === 'off' ||
      rollout.response?.status === 403 ||
      verifiedRoster.status === 'denied'
    ) {
      eligibility = 'denied';
    } else if (computerRollout === 'on' && verifiedRoster.status === 'ready') {
      eligibility = 'terms-unavailable';
    }

    // Purchase terms can call the billing provider. This mode has no offers
    // or write endpoint, including when both read gates are enabled.
    return {
      ...viewer,
      computerRollout,
      roster: verifiedRoster,
      eligibility,
      offers: 'unavailable',
      purchaseEnabled: false,
    };
  }
}

async function readCode(req: IncomingMessage) {
  if (req.headers['content-type'] !== 'text/plain') return;
  const length = Number(req.headers['content-length']);
  if (length !== 6) return;
  let code = '';
  for await (const chunk of req) {
    code += String(chunk);
    if (code.length > 6) return;
  }
  if (/^\d{6}$/.test(code)) return code;
}

function send(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
