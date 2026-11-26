import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Sdk } from '@macro-inc/sdk/generated/auth';
import type { Plugin } from 'vite';

const upstream = 'http://127.0.0.1:23011/auth';
const reviewer = 'macrobots-reviewer@example.test';
const fixtureTeam = 'Macro Bots Local Review';
const cookieName = 'bots-local-session';
const lifetime = 10 * 60 * 1000;

type Session = { expires: number; token?: string };

export function localAuth(path: string): Plugin {
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
            ['/', '/sign-in', '/fleet'].some((route) => route === page)
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
    const options = {
      baseUrl: upstream,
      redirect: 'error' as const,
      signal: AbortSignal.timeout(10_000),
    };

    if (req.method === 'GET' && req.url === path) {
      send(
        res,
        200,
        session?.token
          ? await identity(session.token)
          : { status: 'signed-out' }
      );
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
      send(res, 200, result);
      return;
    }

    send(res, 404, { status: 'unavailable' });
  }

  function issue(res: ServerResponse, session: Pick<Session, 'token'>) {
    const id = randomUUID();
    sessions.set(id, { ...session, expires: Date.now() + lifetime });
    res.setHeader('Set-Cookie', cookie.replace('$ID', id));
  }

  async function identity(token: string) {
    const options = {
      baseUrl: upstream,
      redirect: 'error' as const,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    };
    const user = await sdk.getUserInfo(options);
    if (user.response?.status === 401) return { status: 'signed-out' };
    if (
      user.response?.status !== 200 ||
      user.data?.user_id !== `macro|${reviewer}`
    ) {
      return { status: 'unavailable' };
    }
    const team = await sdk.getTeam(options);
    if (
      team.response?.status !== 200 ||
      team.data?.team.name !== fixtureTeam ||
      !team.data.members.some((member) => member.user_id === user.data?.user_id)
    ) {
      return { status: 'team-unresolved' };
    }
    return { status: 'signed-in' };
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
