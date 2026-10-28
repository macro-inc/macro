import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { Entity } from '@entity';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem } from '@queries/preview/types';
import type { SoupProperty } from '@service-storage/generated/schemas';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { channelTheme } from '../../../theme';
import { StaticMarkdownContext } from '../../core/StaticMarkdown';
import { DocumentMention, DocumentMentionStatic } from '../DocumentMention';

const states = [
  ['Not started', PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
  ['In progress', PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
  ['In review', PROPERTY_OPTION_IDS.STATUS.IN_REVIEW],
  ['Completed', PROPERTY_OPTION_IDS.STATUS.COMPLETED],
  ['Canceled', PROPERTY_OPTION_IDS.STATUS.CANCELED],
] as const;
const time = '2026-10-01T00:00:00Z';
const statusProperty = (statusId: string): SoupProperty => ({
  id: 'task-status-property',
  definition: {
    id: SYSTEM_PROPERTY_IDS.STATUS,
    display_name: 'Status',
    data_type: 'SELECT_STRING',
    is_metadata: false,
    is_multi_select: false,
    is_system: true,
    owner: { scope: 'system' },
    specific_entity_type: 'TASK',
    created_at: time,
    updated_at: time,
  },
  value: { type: 'SelectOption', value: [statusId] },
});

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'viewer@example.com',
});

function StatusExample(props: {
  label: string;
  initialStatus: string;
  completed?: boolean;
  index: number;
}) {
  const [statusId, setStatusId] = createSignal(props.initialStatus);
  const id = `01a17abc-0000-7000-8000-${String(props.index).padStart(12, '0')}`;
  const task = (): TaskEntityWithProperties => ({
    id,
    type: 'document',
    fileType: 'md',
    name: `${props.label} task`,
    ownerId: 'owner',
    subType: { type: 'task', is_completed: props.completed ?? false },
    properties: statusId() ? [statusProperty(statusId())] : [],
  });
  const update = (nextStatus: string) => {
    setStatusId(nextStatus);
    queryClient.setQueryData(previewKeys.item(id).queryKey, {
      id,
      type: 'document',
      fileType: 'md',
      name: task().name,
      rawName: task().name,
      loading: false,
      access: 'access',
      subType: { type: 'task', is_completed: props.completed ?? false },
      documentMetadata: {
        canEdit: false,
        properties: [
          {
            propertyId: 'status',
            propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
            displayName: 'Status',
            isMultiSelect: false,
            owner: { scope: 'system' },
            createdAt: time,
            updatedAt: time,
            valueType: 'SELECT_STRING',
            value: [nextStatus],
          },
        ],
      },
    } satisfies PreviewItem);
  };
  update(props.initialStatus);
  return (
    <section
      aria-label={props.label}
      class="flex flex-wrap items-center gap-5 rounded-xl border border-edge-muted p-4"
    >
      <div class="flex items-center gap-2" data-testid="task-row">
        <span class="size-4">
          <Entity.Icon entity={task()} />
        </span>
        {task().name}
      </div>
      <div data-testid="task-mention">
        <DocumentMention
          key={id}
          documentId={id}
          documentName={task().name}
          blockName="task"
          theme={channelTheme}
        />
      </div>
      <Button onClick={() => update(PROPERTY_OPTION_IDS.STATUS.COMPLETED)}>
        Complete
      </Button>
      <Button onClick={() => update(PROPERTY_OPTION_IDS.STATUS.NOT_STARTED)}>
        Reopen
      </Button>
    </section>
  );
}

function Fixture() {
  return (
    <main class="min-h-screen space-y-4 bg-page p-8 text-ink">
      <h1 class="text-lg font-semibold">Task status — rows and mentions</h1>
      <div data-testid="static-task-mention">
        <DocumentMentionStatic
          key="static-task"
          theme={channelTheme}
          documentId="static-task"
          documentName="Task awaiting preview"
          blockName="task"
        />
      </div>
      <StatusExample
        label="Completion flag only"
        initialStatus=""
        completed
        index={6}
      />
      <StatusExample
        label="Unknown status"
        initialStatus="constructor"
        index={7}
      />
      <For each={states}>
        {([label, status], index) => (
          <StatusExample
            label={label}
            initialStatus={status}
            index={index() + 1}
          />
        )}
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
