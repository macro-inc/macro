import '@app/index.css';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { FormProvider } from '@app/features/block-form/context/form-context';
import type { FormDetail } from '@app/features/block-form/core/form-model';
import { createMockFormContext } from '@app/features/block-form/tests/mock-context';
import { FormCardView } from '@app/features/block-form/views/form-card-view';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem } from '@queries/preview/types';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { channelTheme } from '../../../theme';
import { StaticMarkdownContext } from '../../core/StaticMarkdown';
import { DocumentCard } from '../DocumentCard';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'viewer@example.com',
});

const polls = [
  {
    label: 'Two options',
    question: 'Lunch?',
    options: ['Tacos', 'Pho'],
  },
  {
    label: 'Long question',
    question:
      'Should we hide the support channels from the sidebar for everyone who is not on the support rotation this quarter, and keep them reachable from search?',
    options: [
      'Yes, hide them for everyone outside the rotation',
      'No, keep them visible',
    ],
  },
  {
    label: 'Many options',
    question: 'Which day works for the offsite?',
    options: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
      'Next Monday',
    ],
  },
];

function pollDetail(
  id: string,
  question: string,
  options: string[]
): FormDetail {
  return {
    form: {
      id,
      name: question,
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: true,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
      branding: { logoFileId: null, coverFileId: null, accentColor: null },
    },
    layout: {
      sections: [
        {
          id: 'section',
          title: '',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          bookingTarget: null,
          questions: [
            {
              id: 'question',
              columnId: 'answer',
              helpText: '',
              required: true,
              widget: 'choice',
            },
          ],
        },
      ],
    },
    columns: [
      {
        id: 'answer',
        name: 'Answer',
        kind: { type: 'select', multi: false },
        options: options.map((label, index) => ({
          id: `option-${index}`,
          label,
          color: null,
        })),
      },
    ],
    access: 'edit',
    tableGone: false,
  };
}

function PollExample(props: {
  index: number;
  label: string;
  question: string;
  options: string[];
}) {
  const id = `01a19a29-0000-7000-8000-${String(props.index).padStart(12, '0')}`;
  const detail = pollDetail(id, props.question, props.options);
  queryClient.setQueryData(previewKeys.item(id).queryKey, {
    id,
    type: 'form',
    name: props.question,
    rawName: props.question,
    loading: false,
    access: 'access',
  } satisfies PreviewItem);
  const base = createMockFormContext({ detail });
  const { context } = createMockFormContext({
    detail,
    overrides: {
      responses: {
        ...base.context.responses,
        createTally: () => ({
          value: () => [
            {
              questionId: 'question',
              responses: 3,
              buckets: [{ kind: 'option', optionId: 'option-0', count: 3 }],
            },
          ],
          failure: () => undefined,
        }),
      },
    },
  });
  // The form's detail arrives after its card mounts, as in a channel.
  const [loaded, setLoaded] = createSignal(false);
  const Body = () => (
    <FormProvider value={context}>
      <Show
        when={loaded()}
        fallback={<ListSkeleton.Bar class="h-24 w-full rounded-xl" />}
      >
        <FormCardView
          detail={detail}
          refetch={async () => true}
          narrow={false}
          onOpen={() => {}}
          onOpenResponses={() => {}}
        />
      </Show>
    </FormProvider>
  );
  return (
    <section aria-label={props.label} class="max-w-xl">
      <Button onClick={() => setLoaded(true)}>Load {props.label}</Button>
      <DocumentCard
        key={id}
        documentId={id}
        documentName={props.question}
        blockName="form"
        blockParams={{}}
        previewData={{ poll: { optionCount: props.options.length } }}
        previewComponent={Body}
        theme={channelTheme}
      />
    </section>
  );
}

function Fixture() {
  return (
    <main class="h-screen space-y-6 overflow-y-auto bg-page p-4 text-ink">
      <For each={polls}>
        {(poll, index) => <PollExample index={index() + 1} {...poll} />}
      </For>
    </main>
  );
}

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <StaticMarkdownContext theme={channelTheme}>
              <MemoryRouter>
                <Route path="*" component={Fixture} />
              </MemoryRouter>
            </StaticMarkdownContext>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
