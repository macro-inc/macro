import type {
  WorkspaceComment,
  WorkspaceTask,
} from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';

export const GITHUB_TASK = 'web-42';
export const githubHistory: WorkspaceComment[] = [
  {
    id: 'morning',
    person: 'julia',
    time: '8:42 AM',
    body: 'doing a last pass on the site this morning',
  },
  {
    id: 'screenshots',
    person: 'valentina',
    time: '8:44 AM',
    body: 'new screenshots are in. refresh if you still see the old ones',
    replyTo: 'morning',
  },
  {
    id: 'footer',
    person: 'teo',
    time: '9:02 AM',
    body: 'footer links are fixed',
  },
  {
    id: 'thanks',
    person: 'julia',
    time: '9:04 AM',
    body: 'nice, thanks',
    replyTo: 'footer',
  },
  {
    id: 'bug',
    person: 'julia',
    time: '9:48 AM',
    body: 'sign-in button does nothing on my phone. desktop is fine',
  },
  {
    id: 'repro',
    person: 'teo',
    time: '9:50 AM',
    body: 'same here. looks like the mobile button isn’t submitting the form',
    replyTo: 'bug',
  },
  {
    id: 'task',
    person: 'julia',
    time: '9:52 AM',
    body: 'put the steps here:',
    taskId: GITHUB_TASK,
    replyTo: 'bug',
  },
];
export const githubTask: WorkspaceTask = {
  id: GITHUB_TASK,
  title: 'Fix mobile sign-in',
  description:
    'At mobile widths, tapping Sign in does nothing. The same account works on desktop.\n\nOpen /sign-in on a phone, enter your email and password, then tap Sign in.',
  status: 'In Review',
  priority: 'High',
  owner: 'teo',
  creator: 'julia',
  tags: ['Website'],
  channel: 'website',
  steps: [
    { id: 'mobile', text: 'Sign-in works on mobile', done: true },
    { id: 'desktop', text: 'Desktop and Enter key still work', done: true },
  ],
  comments: [
    {
      id: 'verified',
      person: 'teo',
      time: '10:24 AM',
      body: 'checked both widths. tests are passing too',
    },
  ],
};
export function createGithubWorkspace(agent = false) {
  const w = createDummyWorkspace('messages');
  w.setData('tasks', [
    {
      ...githubTask,
      status: agent ? 'In Progress' : 'In Review',
      steps: githubTask.steps.map((step) => ({ ...step, done: !agent })),
      comments: agent ? [] : [...githubTask.comments],
    },
  ]);
  w.setData('channels', [
    {
      id: 'website',
      messages: [
        ...githubHistory.map((message) => ({ ...message })),
        ...(agent
          ? [
              {
                id: 'request',
                person: 'julia' as const,
                time: '9:54 AM',
                body: '@[Cursor](demo-mention:cursor) can you fix this?',
                taskId: GITHUB_TASK,
              },
            ]
          : [
              { id: 'pr', person: 'teo' as const, time: '10:14 AM', body: '' },
              {
                id: 'reviewing',
                person: 'julia' as const,
                time: '10:16 AM',
                body: 'thanks, checking now',
                replyTo: 'pr',
              },
            ]),
      ],
    },
  ]);
  w.openItem('messages', 'website');
  w.setChannel('website');
  return w;
}

export const signInFiles = [
  {
    path: 'src/auth/SignIn.tsx',
    oldText: `export function SignIn() {
  const submit = useSignIn();

  return (
    <form>
      <EmailField />
      <PasswordField />
      <button class="desktop" onClick={submit}>
        Sign in
      </button>
      <button class="mobile" type="button">
        Sign in
      </button>
    </form>
  );
}
`,
    newText: `export function SignIn() {
  const submit = useSignIn();

  return (
    <form onSubmit={submit}>
      <EmailField />
      <PasswordField />
      <button class="desktop" type="submit">
        Sign in
      </button>
      <button class="mobile" type="submit">
        Sign in
      </button>
    </form>
  );
}
`,
  },
  {
    path: 'src/auth/SignIn.test.tsx',
    oldText: `import { expect, test } from '@playwright/test';
`,
    newText: `import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(\`signs in at \${width}px\`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/home');
  });
}
`,
  },
];
