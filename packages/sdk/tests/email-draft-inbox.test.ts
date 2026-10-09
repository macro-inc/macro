import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type {
  ParsedMessage,
  TransferDraftResponse,
} from '../generated/email/types.gen';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

const message: ParsedMessage = {
  db_id: '0198a4cc-e138-7670-a308-a6b766602700',
  link_id: '0198a4cc-e138-7670-a308-a6b766602701',
  thread_db_id: '0198a4cc-e138-7670-a308-a6b766602702',
  bcc: [],
  cc: [],
  to: [],
  labels: [],
};
const transferred: TransferDraftResponse = {
  message_id: '0198a4cc-e138-7670-a308-a6b766602703',
  thread_id: '0198a4cc-e138-7670-a308-a6b766602704',
  source_id: message.db_id,
  source_thread_id: message.thread_db_id,
  attachments: [],
};

for (const action of ['attachment completion', 'draft transfer'] as const) {
  test(`${action} uses the draft's secondary inbox instead of the primary inbox`, async () => {
    const requests: Request[] = [];
    const fetchMock = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request);
        if (request.method === 'GET') return Response.json(message);
        if (request.headers.get('X-Email-Link-Id') !== message.link_id) {
          return new Response('Draft is not in the primary inbox', {
            status: 403,
          });
        }
        return action === 'draft transfer'
          ? Response.json(transferred)
          : new Response(null, { status: 204 });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    const macro = new Macro({
      auth: { type: 'user', apiKey: 'mak_test' },
      hosts: { email: 'https://email.example.test' },
    });
    const draft = macro.email.message(message.db_id);
    if (action === 'draft transfer') {
      const request = {
        operation_id: '0198a4cc-e138-7670-a308-a6b766602705',
        destination_link_id: '0198a4cc-e138-7670-a308-a6b766602706',
      };
      expect(await draft.transferDraft(request)).toEqual(transferred);
      expect(await requests[1].json()).toEqual(request);
    } else {
      await draft.completeDraftAttachment(
        '0198a4cc-e138-7670-a308-a6b766602707',
      );
      expect(new URL(requests[1].url).pathname).toEndWith(
        '/attachments/0198a4cc-e138-7670-a308-a6b766602707/complete',
      );
    }
    expect(requests).toHaveLength(2);
    expect(requests[1].method).toBe('POST');
    expect(requests[1].headers.get('X-Email-Link-Id')).toBe(message.link_id);
    expect(new URL(requests[1].url).pathname).toStartWith(
      `/email/drafts/${message.db_id}/`,
    );
  });
}
