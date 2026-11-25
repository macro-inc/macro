/**
 * A loopback stand-in for an OpenAI-compatible chat completions endpoint, so
 * the Kimi adapter can be exercised without a provider. It keeps every request
 * it receives and answers with whatever completion body it is given.
 */
export type StandInReply = { status: number; body: unknown };

export type StandIn = {
  baseUrl: string;
  requests: unknown[];
  stop: () => Promise<void>;
};

export const fixedChoiceReply = (choice: string): StandInReply => ({
  status: 200,
  body: {
    model: 'stand-in',
    choices: [{ message: { content: JSON.stringify({ choice }) } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  },
});

export const startStandIn = (
  reply: (request: unknown) => StandInReply,
  onRequest: (request: unknown) => void = () => {},
  port = 0
): StandIn => {
  const requests: unknown[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (
        request.method !== 'POST' ||
        url.pathname !== '/v1/chat/completions'
      ) {
        return new Response('not found', { status: 404 });
      }
      const body: unknown = await request.json();
      requests.push(body);
      onRequest(body);
      const { status, body: answer } = reply(body);
      return Response.json(answer, { status });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop: () => server.stop(true),
  };
};
