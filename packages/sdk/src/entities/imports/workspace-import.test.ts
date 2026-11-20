import { describe, expect, test } from 'bun:test';
import type { PlanWorkspaceImportRequest } from '../../../generated/cognition/types.gen';
// Documents and tasks import each other; load them in the SDK's entry order.
import '../../macro';
import type { MacroClient } from '../../utils/client';
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
});
