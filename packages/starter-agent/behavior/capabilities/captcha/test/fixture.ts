/**
 * Local pages that look like the checks the solver handles, and a stand-in
 * for the harness's brain routes. Nothing here loads a third party's script:
 * the widgets are bare markup with test site keys, which is all detection
 * reads.
 */

/** Cloudflare's always-passes Turnstile test site key. */
export const turnstileTestKey = '1x00000000000000000000AA';
/** Google's reCAPTCHA v2 test site key. */
export const recaptchaTestKey = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

const html = (body: string, title = 'Fixture') =>
  new Response(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    {
      headers: { 'content-type': 'text/html' },
    }
  );

/** The fixture pages, by path. */
export const fixturePage = (path: string): Response => {
  if (path === '/turnstile')
    return html(`
      <form id="login"><input name="user">
        <div class="cf-turnstile" data-sitekey="${turnstileTestKey}" data-action="login" data-callback="onSolved"></div>
        <input type="hidden" name="cf-turnstile-response">
      </form>
      <script>
        window.onSolved = (token) => {
          document.body.dataset.token = token;
          document.querySelector('.cf-turnstile').remove();
        };
      </script>`);
  if (path === '/recaptcha')
    return html(`
      <form id="contact" action="/sent" method="get">
        <div class="g-recaptcha" data-sitekey="${recaptchaTestKey}"></div>
        <textarea name="g-recaptcha-response" style="display:none"></textarea>
      </form>`);
  if (path === '/recaptcha-v3')
    return html(`
      <script type="text/plain" src="https://www.google.com/recaptcha/api.js?render=${recaptchaTestKey}"></script>
      <input type="hidden" name="g-recaptcha-response">
      <script>window.grecaptcha = { execute: () => Promise.resolve('page-own') };</script>`);
  if (path === '/interstitial')
    return html('<form id="challenge-form"></form>', 'Just a moment...');
  if (path === '/sent') return html('<p>Sent</p>', 'Sent');
  return html('<p>Nothing to see</p>', 'Plain');
};

/** What the stand-in brain saw. */
export type BrainSeen = {
  readonly path: string;
  readonly authorization: string | null;
  /** The solver run header (`x-macro-solver-run`). */
  readonly run: string | null;
  readonly body: unknown;
};

/** The run id the stand-in harness hands out. */
export const standInRunId = '01a1fa00-0000-7000-8000-00000000c0de';

export type ChatTurn = (body: {
  readonly messages: ReadonlyArray<{ readonly role: string }>;
  readonly tools?: ReadonlyArray<{
    readonly function: { readonly name: string };
  }>;
}) => { readonly tool?: string; readonly text?: string };

/** An OpenAI-style streamed reply: one tool call, or text. */
const streamed = (model: string, turn: ReturnType<ChatTurn>): Response => {
  const delta =
    turn.tool === undefined
      ? { role: 'assistant', content: turn.text ?? '' }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: turn.tool, arguments: '{}' },
            },
          ],
        };
  const chunks = [
    {
      id: 'chatcmpl-standin',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta }],
    },
    {
      id: 'chatcmpl-standin',
      object: 'chat.completion.chunk',
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: turn.tool === undefined ? 'stop' : 'tool_calls',
        },
      ],
    },
    {
      id: 'chatcmpl-standin',
      object: 'chat.completion.chunk',
      model,
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];
  const text = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(text, {
    headers: { 'content-type': 'text/event-stream' },
  });
};

/**
 * One server for both: the fixture pages, and the brain routes the relay
 * would forward to (`/brain/captcha/solve` answers `solve`, the chat route
 * answers `chat`).
 */
export const startFixture = ({
  solve,
  chat,
}: {
  readonly solve: (body: unknown) => unknown | Promise<unknown>;
  readonly chat?: ChatTurn;
}) => {
  const seen: BrainSeen[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith('/brain/')) return fixturePage(pathname);
      const body: unknown = await request.json();
      seen.push({
        path: pathname,
        authorization: request.headers.get('authorization'),
        run: request.headers.get('x-macro-solver-run'),
        body,
      });
      if (/^\/brain\/captcha\/runs\/[^/]+\/end$/.test(pathname))
        return Response.json({ outcome: 'ended' });
      if (pathname === '/brain/captcha/runs')
        return Response.json({
          outcome: 'started',
          runId: standInRunId,
          expiresAt: '2026-11-20T00:06:00Z',
          modelCalls: 16,
          solves: 2,
        });
      if (pathname === '/brain/captcha/solve')
        return Response.json(await solve(body));
      if (
        pathname === '/brain/fireworks/v1/chat/completions' &&
        chat !== undefined
      ) {
        const typed = body as Parameters<ChatTurn>[0] & {
          readonly model: string;
        };
        return streamed(typed.model, chat(typed));
      }
      return new Response('no such route', { status: 404 });
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    seen,
    stop: () => server.stop(true),
  };
};
