export type DemoPage =
  | 'home'
  | 'messages'
  | 'documents'
  | 'tasks'
  | 'agents'
  | 'email'
  | 'calendar'
  | 'crm'
  | 'spreadsheet';

export type DemoMessage = {
  id: string;
  person: 'jacob' | 'julia' | 'teo';
  body: string;
};

export const DEMO_DOCUMENT = `One shared workspace. One great launch.

## The story

Bring email, conversations, documents, and agents together so the whole team can move faster.

## Launch checklist

- [x] Finalize the product story
- [x] Review the launch announcement
- [ ] Send the customer email
- [ ] Publish the changelog

## Owners

**Julia** — announcement and customer email  
**Teo** — deploy and release checks  
**Jacob** — customer conversations

> Try editing this document. Your changes stay in this demo.`;

export const DEMO_CHANNEL: DemoMessage[] = [
  {
    id: 'launch-1',
    person: 'julia',
    body: 'The launch announcement is ready. Can we do one last pass before Thursday?',
  },
  {
    id: 'launch-2',
    person: 'teo',
    body: 'Deploy checks look good. Cursor is wrapping up the retry fix, and I’ll review the pull request next.',
  },
  {
    id: 'launch-3',
    person: 'jacob',
    body: 'Perfect. The launch plan has the checklist and owners. Let’s keep everything here in **#launch**.',
  },
];

export const DEMO_TASKS = [
  {
    id: 'story',
    label: 'Finalize the product story',
    done: true,
    owner: 'Julia',
  },
  {
    id: 'release',
    label: 'Review the deploy pull request',
    done: false,
    owner: 'Teo',
  },
  {
    id: 'email',
    label: 'Send the customer announcement',
    done: false,
    owner: 'Jacob',
  },
  {
    id: 'changelog',
    label: 'Publish the changelog',
    done: false,
    owner: 'Teo',
  },
];

/** Deliberately scripted: the public demo never calls a model or a tool. */
export function demoAgentReply(prompt: string, coding: boolean) {
  if (coding)
    return /test|check/i.test(prompt)
      ? 'The sample run passed all 12 retry tests. It covers transient errors, retry limits, and permanent failures. Expand the tool activity above to inspect the output.'
      : 'The retry fix is ready for review. It adds exponential backoff for transient registry failures and keeps permanent failures visible. Next step: Teo reviews the pull request.';
  return /who|owner/i.test(prompt)
    ? '**Julia** owns the announcement, **Teo** owns deploy checks, and **Jacob** owns customer conversations. The same owners are listed in the launch plan.'
    : 'Here’s the launch summary:\n\n- The product story and announcement are ready.\n- Teo is reviewing the deploy fix.\n- The customer email and changelog are next.\n\nYou can open **Docs** or **Tasks** in the sidebar to explore the plan.';
}
