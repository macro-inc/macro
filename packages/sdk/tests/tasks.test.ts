import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Task.forPullRequest', () => {
  test('looks up the tasks a pull request references by its key', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        pullRequests: [
          {
            githubKey: 'macro-inc/macro/pull/12',
            taskIds: [
              '0198a4cc-e138-7670-a308-a6b766602710',
              '0198a4cc-e138-7670-a308-a6b766602711',
            ],
          },
        ],
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const tasks = await macro.tasks.forPullRequest(
      'https://github.com/macro-inc/macro/pull/12#discussion',
    );

    expect(tasks.map((task) => task.id)).toEqual([
      '0198a4cc-e138-7670-a308-a6b766602710',
      '0198a4cc-e138-7670-a308-a6b766602711',
    ]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(
      '/documents/github_prs/tasks',
    );
    expect(await requests[0].json()).toEqual({
      githubKeys: ['macro-inc/macro/pull/12'],
    });
  });

  test('rejects URLs that are not GitHub pull requests', async () => {
    const macro = new Macro({ token: 'user-token' });
    await expect(
      macro.tasks.forPullRequest(
        'https://github.com/macro-inc/macro/issues/12',
      ),
    ).rejects.toThrow('Expected a GitHub pull request URL');
  });
});
