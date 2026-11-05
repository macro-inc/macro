// The brain's localhost endpoint. macrod polls `GET /health`; turns reach the
// running brain through the rest (the `brain post|reply|context|handoff|...`
// commands), so the agent's Macro key, its memory writes, and its secrets stay
// in this one process. Every route but /health needs the per-start control
// token the brain hands its turns.
import { match, P } from 'ts-pattern';
import type { Trigger } from './schedules.ts';
import { withRemoteSpan } from './telemetry.ts';

export type Health = {
  status: 'ok' | 'degraded';
  startedAt: string;
  connected: boolean;
  lastEventAt: string | null;
  lastTurnAt: string | null;
  turns: { id: string; tier: string; startedAt: string }[];
  work: {
    conversation: string;
    taskId: string;
    label: string;
    startedAt: string;
  }[];
  spentTodayUsd: number;
  problems: string[];
};

export type Conversation = { channel: string; root: string | null };

/** What the control routes do; the brain implements it. */
export interface Control {
  health(): Promise<Health>;
  post(
    turn: string | null,
    channel: string,
    text: string
  ): Promise<{ id: string }>;
  reply(
    turn: string | null,
    channel: string,
    root: string,
    text: string
  ): Promise<{ id: string }>;
  context(channel: string, root: string | null): Promise<unknown[]>;
  handoff(
    conversation: Conversation,
    label: string,
    task: string
  ): Promise<{ taskId: string }>;
  remember(topic: string, text: string): Promise<void>;
  recall(query: string): Promise<unknown>;
  forget(topic: string): Promise<void>;
  focus(focus: string): Promise<void>;
  promise(what: string, to: string, conversation: string | null): Promise<void>;
  release(match: string): Promise<{ released: number }>;
  schedule(note: string, trigger: Trigger): Promise<unknown>;
  schedules(): Promise<unknown>;
  unschedule(routineId: string): Promise<void>;
  secret(name: string): Promise<string>;
}

export const TOKEN_HEADER = 'x-brain-control-token';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new RequestError(`${name} is required`);
  return value;
};

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

class RequestError extends Error {}

const trigger = (value: unknown): Trigger =>
  match(value)
    .with(
      { type: 'cron', schedule: P.string, timezone: P.string },
      ({ schedule, timezone }) => ({
        type: 'cron' as const,
        schedule,
        timezone,
      })
    )
    .with({ type: 'once', at: P.string }, ({ at }) => ({
      type: 'once' as const,
      at,
    }))
    .otherwise(() => {
      throw new RequestError(
        'trigger must be {type:"cron",schedule,timezone} or {type:"once",at}'
      );
    });

/** The request handler, separate from `Deno.serve` so tests call it directly. */
export function controlHandler(
  control: Control,
  token: string,
  log: (line: object) => void
) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /health') {
      const health = await control.health();
      return json(health, health.status === 'ok' ? 200 : 503);
    }
    if (request.headers.get(TOKEN_HEADER) !== token)
      return json({ error: 'forbidden' }, 403);

    return withRemoteSpan(request.headers.get('traceparent'), async () => {
      try {
        const body =
          request.method === 'POST'
            ? ((await request.json()) as Record<string, unknown>)
            : {};
        const turn = optionalText(body.turn);
        const query = (name: string) => url.searchParams.get(name);

        const unscheduled = /^DELETE \/schedules\/([^/]+)$/.exec(route);
        if (unscheduled?.[1]) {
          await control.unschedule(decodeURIComponent(unscheduled[1]));
          return json({ ok: true });
        }
        const secret = /^GET \/secrets\/([^/]+)$/.exec(route);
        if (secret?.[1]) {
          return json({
            value: await control.secret(decodeURIComponent(secret[1])),
          });
        }

        return await match(route)
          .with('POST /talk/post', async () =>
            json(
              await control.post(
                turn,
                text(body.channel, 'channel'),
                text(body.text, 'text')
              )
            )
          )
          .with('POST /talk/reply', async () =>
            json(
              await control.reply(
                turn,
                text(body.channel, 'channel'),
                text(body.root, 'root'),
                text(body.text, 'text')
              )
            )
          )
          .with('GET /talk/context', async () =>
            json(
              await control.context(
                text(query('channel'), 'channel'),
                query('root')
              )
            )
          )
          .with('POST /handoff', async () => {
            const conversation = {
              channel: text(body.channel, 'channel'),
              root: optionalText(body.root),
            };
            return json(
              await control.handoff(
                conversation,
                text(body.label, 'label'),
                text(body.task, 'task')
              )
            );
          })
          .with('POST /memory/remember', async () => {
            await control.remember(
              text(body.topic, 'topic'),
              text(body.text, 'text')
            );
            return json({ ok: true });
          })
          .with('GET /memory/recall', async () =>
            json(await control.recall(text(query('q'), 'q')))
          )
          .with('POST /memory/forget', async () => {
            await control.forget(text(body.topic, 'topic'));
            return json({ ok: true });
          })
          .with('POST /memory/focus', async () => {
            await control.focus(text(body.focus, 'focus'));
            return json({ ok: true });
          })
          .with('POST /memory/promise', async () => {
            await control.promise(
              text(body.what, 'what'),
              text(body.to, 'to'),
              optionalText(body.conversation)
            );
            return json({ ok: true });
          })
          .with('POST /memory/release', async () =>
            json(await control.release(text(body.match, 'match')))
          )
          .with('POST /schedules', async () =>
            json(
              await control.schedule(
                text(body.note, 'note'),
                trigger(body.trigger)
              )
            )
          )
          .with('GET /schedules', async () => json(await control.schedules()))
          .otherwise(async () => json({ error: `no route ${route}` }, 404));
      } catch (error) {
        if (error instanceof RequestError || error instanceof SyntaxError)
          return json({ error: error.message }, 400);
        log({ control: route, error: String(error) });
        return json({ error: String(error) }, 500);
      }
    });
  };
}

/** Call the running brain from a turn's `brain` command. */
export async function callBrain(
  env: (name: string) => string | undefined,
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: object
): Promise<unknown> {
  const port = env('BRAIN_HEALTH_PORT');
  const token = env('BRAIN_CONTROL_TOKEN');
  if (!port || !token) {
    throw new Error(
      'BRAIN_HEALTH_PORT and BRAIN_CONTROL_TOKEN must be set; talk commands run inside a brain turn'
    );
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      [TOKEN_HEADER]: token,
      'content-type': 'application/json',
      ...(env('BRAIN_TURN_TRACEPARENT')
        ? { traceparent: env('BRAIN_TURN_TRACEPARENT') ?? '' }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : JSON.stringify({ turn: env('BRAIN_TURN_ID') ?? null, ...body }),
  });
  const result = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(`brain ${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
