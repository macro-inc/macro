import { describe, expect, test } from 'bun:test';
import type { PlanWorkspaceImportRequest } from '../../../generated/cognition/types.gen';
// Documents and tasks import each other; load them in the SDK's entry order.
import '../../macro';
import type { MacroClient } from '../../utils/client';
import type { SessionReview } from '../agent-sessions/review';
import { ImportNamespace } from './namespace';

describe('workspace imports', () => {
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

    const report = await new ImportNamespace(client).notion.plan({
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
            error: 'who should see this import was not chosen',
          },
          response: new Response(null, { status: 409 }),
        }),
      },
    } as unknown as MacroClient;

    await expect(
      new ImportNamespace(client).linear.plan(),
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
    const imports = new ImportNamespace(client);

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

  test('start approves only an import review of the same source and reports where it stands', async () => {
    const submitted: string[] = [];
    const review = (id: string, source: string) =>
      ({
        id,
        items: async () => [{ draft: { source } }],
        submitAll: async () => {
          submitted.push(id);
        },
      }) as unknown as SessionReview;
    const client = {
      cognition: {
        workspaceReportHandler: async ({
          path,
        }: {
          path: { source: string };
        }) => ({
          data: { status: 'importing', imported: path.source.length },
        }),
      },
    } as unknown as MacroClient;
    const imports = new ImportNamespace(client);

    // Returned as-is from a code-mode program, so it must be JSON.
    expect(
      await imports.linear.start(review('linear-review', 'linear')),
    ).toMatchObject({ status: 'importing', imported: 'linear'.length });
    await expect(
      imports.jira.start(review('notion-review', 'notion')),
    ).rejects.toThrow('does not present a jira import');

    expect(submitted).toEqual(['linear-review']);
  });

  test('start refuses a review with no drafts or a draft that is not an import', async () => {
    let submitted = 0;
    const review = (id: string, drafts: unknown[]) =>
      ({
        id,
        items: async () => drafts.map((draft) => ({ draft })),
        submitAll: async () => {
          submitted += 1;
        },
      }) as unknown as SessionReview;
    const imports = new ImportNamespace({} as MacroClient);

    await expect(
      imports.notion.start(review('empty-review', [])),
    ).rejects.toThrow('does not present a notion import');
    await expect(
      imports.notion.start(
        review('email-review', [{ to: ['user@example.com'], subject: 'Hi' }]),
      ),
    ).rejects.toThrow('does not present a notion import');

    expect(submitted).toBe(0);
  });
});
