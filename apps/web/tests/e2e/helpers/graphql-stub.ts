import type { Page, Route } from '@playwright/test';

export type GraphqlStubRequest = {
  operationName: string;
  variables: Record<string, unknown>;
};

export type GraphqlStubResponse =
  | { data: unknown }
  | { errors: Array<{ message: string }> };

/**
 * Answers selected soup GraphQL operations from the test. Operations the
 * resolver returns `undefined` for pass through to the real backend, so a
 * spec stubs only the surface under test. Runs on the page and its workers.
 */
export async function stubSoupGraphql(
  page: Page,
  resolve: (request: GraphqlStubRequest) => GraphqlStubResponse | undefined
): Promise<void> {
  await page.route('**/items/soup/graphql', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = request.postDataJSON() as {
      operationName?: string;
      query?: string;
      variables?: Record<string, unknown>;
    };
    const operationName =
      body.operationName ??
      /\b(?:query|mutation|subscription)\s+(\w+)/.exec(body.query ?? '')?.[1] ??
      '';
    const response = resolve({
      operationName,
      variables: body.variables ?? {},
    });
    if (!response) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}
