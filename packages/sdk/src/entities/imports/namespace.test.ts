import { describe, expect, test } from 'bun:test';
import type {
  ImportEntity,
  PlanWorkspaceImportRequest,
  TrackImportEntityRequest,
} from '../../../generated/cognition/types.gen';
import type { MacroClient } from '../../utils/client';
import type { SessionReview } from '../agent-sessions/review';
import { Document } from '../documents/document';
import { Task } from '../tasks/task';
import { ImportsNamespace } from './namespace';

const stagedIssue: ImportEntity = {
  id: '0b8c1f6e-4d7a-4a52-9a43-6f2d5b3e9c11',
  user_id: 'macro|user@example.com',
  team_id: null,
  source: 'linear',
  kind: 'issue',
  foreign_id: 'ENG-142',
  parent_id: null,
  review_id: null,
  status: 'staged',
  initiator: 'chat',
  metadata: { identifier: 'ENG-142', title: 'Fix login' },
  entity_id: null,
  entity_type: null,
  last_error: null,
  created_at: '2026-11-05T12:00:00Z',
  updated_at: '2026-11-05T12:00:00Z',
};

describe('imports', () => {
  test('plan sends the Notion roots and sharing choice to the Notion plan route', async () => {
    const requests: Array<{
      path: { source: string };
      body: PlanWorkspaceImportRequest;
    }> = [];
    const client = {
      cognition: {
        planWorkspaceHandler: async (request: {
          path: { source: string };
          body: PlanWorkspaceImportRequest;
        }) => {
          requests.push(request);
          return { data: { status: 'running', onTeam: true } };
        },
      },
    } as unknown as MacroClient;

    const report = await new ImportsNamespace(client).notion.plan({
      sharing: 'team',
      roots: ['https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7'],
    });

    expect(requests).toEqual([
      {
        path: { source: 'notion' },
        body: {
          sharing: 'team',
          roots: [
            'https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7',
          ],
        },
      },
    ]);
    expect(report).toMatchObject({ status: 'running', onTeam: true });
  });

  test('a tracker plan without a sharing choice surfaces sharing_required', async () => {
    const client = {
      cognition: {
        planWorkspaceHandler: async () => ({
          error: {
            code: 'sharing_required',
            error: 'who should see the Notion import was not chosen',
          },
          response: new Response(null, { status: 409 }),
        }),
      },
    } as unknown as MacroClient;

    await expect(
      new ImportsNamespace(client).linear.plan(),
    ).rejects.toMatchObject({
      status: 409,
      data: { code: 'sharing_required' },
    });
  });

  test('status and cancel address the workspace by source', async () => {
    const calls: string[] = [];
    const client = {
      cognition: {
        workspaceReportHandler: async ({
          path,
        }: {
          path: { source: string };
        }) => {
          calls.push(`status ${path.source}`);
          return { data: { status: 'importing', imported: 3 } };
        },
        cancelWorkspaceHandler: async ({
          path,
        }: {
          path: { source: string };
        }) => {
          calls.push(`cancel ${path.source}`);
          return { data: { status: 'dismissed', imported: 3 } };
        },
      },
    } as unknown as MacroClient;
    const imports = new ImportsNamespace(client);

    expect(await imports.jira.status()).toMatchObject({
      status: 'importing',
      imported: 3,
    });
    expect(await imports.notion.cancel()).toMatchObject({
      status: 'dismissed',
      imported: 3,
    });
    expect(calls).toEqual(['status jira', 'cancel notion']);
  });

  test('start approves only an import review of the same source', async () => {
    const submitted: string[] = [];
    const review = (id: string, source: string) =>
      ({
        id,
        items: async () => [{ draft: { source } }],
        submitAll: async () => {
          submitted.push(id);
        },
      }) as unknown as SessionReview;
    const imports = new ImportsNamespace({} as unknown as MacroClient);

    await imports.linear.start(review('linear-review', 'linear'));
    await expect(
      imports.jira.start(review('notion-review', 'notion')),
    ).rejects.toThrow('does not present a jira import');

    expect(submitted).toEqual(['linear-review']);
  });

  test('stage and recordImported track items, the latter with the created entity', async () => {
    const requests: TrackImportEntityRequest[] = [];
    const client = {
      cognition: {
        trackEntityHandler: async ({
          body,
        }: {
          body: TrackImportEntityRequest;
        }) => {
          requests.push(body);
          return body.entityId
            ? {
                data: {
                  outcome: 'imported',
                  entity: {
                    ...stagedIssue,
                    status: 'imported',
                    entity_id: body.entityId,
                    entity_type: 'task',
                  },
                },
              }
            : {
                data: {
                  outcome: 'already_imported_by_teammate',
                  entity: {
                    ...stagedIssue,
                    user_id: 'macro|teammate@example.com',
                    status: 'imported',
                    entity_id: 'task-of-teammate',
                    entity_type: 'task',
                  },
                },
              };
        },
      },
    } as unknown as MacroClient;
    const imports = new ImportsNamespace(client);
    const issue = {
      source: 'linear' as const,
      foreignId: 'ENG-142',
      metadata: { identifier: 'ENG-142', title: 'Fix login' },
    };

    const staged = await imports.ledger.stage(issue);
    const recorded = await imports.ledger.recordImported(
      issue,
      Task.byId(client, 'task-1'),
    );

    expect(requests).toEqual([
      { ...issue, entityId: undefined },
      { ...issue, entityId: 'task-1' },
    ]);
    expect(staged.outcome).toBe('already_imported_by_teammate');
    const existing = await staged.item.entity();
    expect(existing).toBeInstanceOf(Task);
    expect(existing?.id).toBe('task-of-teammate');
    expect((await staged.item.importedBy()).id).toBe(
      'macro|teammate@example.com',
    );
    expect(await recorded.status()).toBe('imported');
  });

  test('list filters the ledger and decline discards a staged item', async () => {
    const calls: string[] = [];
    const client = {
      cognition: {
        listEntitiesHandler: async ({
          query,
        }: {
          query: { source?: string; status?: string };
        }) => {
          calls.push(`list ${query.source} ${query.status}`);
          return { data: [stagedIssue] };
        },
        discardEntityHandler: async ({ path }: { path: { id: string } }) => {
          calls.push(`discard ${path.id}`);
          return { data: undefined };
        },
      },
    } as unknown as MacroClient;

    const { ledger } = new ImportsNamespace(client);
    const [item] = await ledger.list({
      source: 'linear',
      status: 'staged',
    });
    expect(await item?.foreignId()).toBe('ENG-142');
    expect(await item?.entity()).toBeUndefined();
    if (item) await ledger.decline(item);

    expect(calls).toEqual(['list linear staged', `discard ${stagedIssue.id}`]);
  });

  test('notion.importPage returns the document the page became', async () => {
    const pages: string[] = [];
    const client = {
      cognition: {
        importNotionPageHandler: async ({
          body,
        }: {
          body: { pageUrl: string };
        }) => {
          pages.push(body.pageUrl);
          return {
            data: {
              outcome: 'imported',
              entity: {
                ...stagedIssue,
                source: 'notion',
                kind: 'page',
                foreign_id: '3fb607323e2e80629886fc0c028d50a7',
                status: 'imported',
                entity_id: 'document-1',
                entity_type: 'md',
              },
            },
          };
        },
      },
    } as unknown as MacroClient;

    const { outcome, item } = await new ImportsNamespace(
      client,
    ).notion.importPage(
      'https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7',
    );

    expect(pages).toEqual([
      'https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7',
    ]);
    expect(outcome).toBe('imported');
    const document = await item.entity();
    expect(document).toBeInstanceOf(Document);
    expect(document?.id).toBe('document-1');
  });
});
