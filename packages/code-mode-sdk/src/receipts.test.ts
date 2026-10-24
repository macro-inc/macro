import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  observeSdk,
  type RequestActivity,
  setDefaultRequestObserver,
} from '../../sdk/src/utils/activity';
import { type ObservedRequest, observeRequests, RECEIPTS, receipt } from './receipts';

const operations = new URL(
  '../../../crates/agent_code_mode/src/domain/operations.json',
  import.meta.url
);

const DOCUMENT = '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6';

function completed(service: string, operation: string): RequestActivity {
  return { id: 1, service, operation, status: 'completed' };
}

afterEach(() => setDefaultRequestObserver(() => {}));

describe('receipts', () => {
  it('names only operations the generated catalog has', async () => {
    const catalog = JSON.parse(await readFile(operations, 'utf8'));
    expect(Object.keys(RECEIPTS).filter((key) => !(key in catalog))).toEqual(
      []
    );
  });

  it('reads a created item and its name from the response', () => {
    expect(
      receipt(completed('storage', 'createMarkdownHandler'), {
        args: [{ body: { documentName: 'Draft' } }],
        result: {
          data: {
            documentId: DOCUMENT,
            documentMetadata: { documentName: '  Q3\n plan ' },
          },
        },
      })
    ).toEqual({
      type: 'document',
      id: DOCUMENT,
      action: 'created',
      title: 'Q3 plan',
    });
  });

  it('tells a rename from a move made through the same operation', () => {
    const edit = (body: object) =>
      receipt(completed('storage', 'editDocument'), {
        args: [{ path: { document_id: DOCUMENT }, body }],
        result: { data: { data: { success: true } } },
      });
    expect(edit({ documentName: 'Plan' })).toEqual({
      type: 'document',
      id: DOCUMENT,
      action: 'renamed',
      title: 'Plan',
    });
    expect(edit({ projectId: '' })).toEqual({
      type: 'document',
      id: DOCUMENT,
      action: 'moved',
    });
    expect(edit({ sharePermission: {} })).toBeUndefined();
  });

  it('cards a comment and a channel post, not another entity message', () => {
    const post = (parent_type: string) =>
      receipt(completed('storage', 'entityMessageCreate'), {
        args: [{ path: { parent_type, parent_id: DOCUMENT } }],
        result: { data: { id: 'message' } },
      });
    expect(post('document')?.action).toBe('commented');
    expect(post('channel')).toEqual({
      type: 'channel',
      id: DOCUMENT,
      action: 'sent',
    });
    expect(post('crm_company')).toBeUndefined();
  });

  it('cards a property change on the items a card can open', () => {
    const set = (entity_type: string) =>
      receipt(completed('properties', 'setEntityProperty'), {
        args: [{ path: { entity_type, entity_id: DOCUMENT } }],
        result: {},
      });
    expect(set('THREAD')?.type).toBe('email_thread');
    expect(set('CHAT')).toBeUndefined();
  });

  it('cards nothing for a call that has not completed or misses its id', () => {
    const call = {
      args: [{}],
      result: { data: { documentId: DOCUMENT } },
    };
    expect(
      receipt(
        { ...completed('storage', 'createMarkdownHandler'), status: 'started' },
        call
      )
    ).toBeUndefined();
    expect(
      receipt(completed('storage', 'createMarkdownHandler'), {
        args: [{}],
        result: { data: {} },
      })
    ).toBeUndefined();
    expect(receipt(completed('storage', 'getDocument'), call)).toBeUndefined();
  });

  it('passes every operation on and attaches at most 32 items to a run', async () => {
    const observed: ObservedRequest[] = [];
    observeRequests((event) => {
      observed.push(event);
    });
    const sdk = observeSdk(
      {
        async createMarkdownHandler() {
          return { data: { documentId: DOCUMENT } };
        },
      },
      'storage'
    );
    for (let index = 0; index < 33; index += 1)
      await sdk.createMarkdownHandler();
    const done = observed.filter((event) => event.status === 'completed');
    expect(observed).toHaveLength(66);
    expect(done.filter((event) => event.item)).toHaveLength(32);
    expect(done.at(-1)?.item).toBeUndefined();
  });
});
