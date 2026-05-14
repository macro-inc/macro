import { useSplitLayout } from '@app/component/split-layout/layout';
import { formatRelativeDate } from '@core/util/time';
import PencilIcon from '@icon/regular/pencil-simple.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import PlusIcon from '@icon/regular/plus.svg';
import { type EmailEntity, isEmailEntity } from '@entity';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardItemRow,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const DRAFTS_LIMIT = 5;

interface DraftsSectionProps {
  class?: string;
}

export function DraftsSection(props: DraftsSectionProps) {
  const { openWithSplit } = useSplitLayout();

  const handleSeeAll = () => {
    openWithSplit({ type: 'component', id: 'mail' });
  };

  return (
    <DashboardSection
      title="Email Drafts"
      icon={<PencilIcon />}
      accent="warning"
      class={props.class}
      onSeeAll={handleSeeAll}
      fallback={<DashboardSectionLoading rows={3} />}
    >
      <DraftsContent />
    </DashboardSection>
  );
}

function DraftsContent() {
  const { openWithSplit } = useSplitLayout();

  const draftsArgs = createMemo(
    (): SoupItemsQueryArgs => ({
      params: {
        sort_method: 'updated_at',
        limit: DRAFTS_LIMIT * 4,
      },
      body: {},
    })
  );

  const draftsQuery = useSoupItemsQuery(draftsArgs);

  const emailDrafts = createMemo(() => {
    const data = draftsQuery.data ?? [];
    return data
      .filter(isEmailEntity)
      .filter((e) => e.isDraft)
      .slice(0, DRAFTS_LIMIT);
  });

  const handleDraftClick = (draft: EmailEntity) => {
    openWithSplit({
      type: 'email',
      id: draft.id,
    });
  };

  const handleNewEmail = () => {
    openWithSplit({ type: 'component', id: 'mail' });
  };

  return (
    <Show
      when={emailDrafts().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<EnvelopeIcon />}
          title="No drafts"
          description="Your email drafts will appear here"
          action={
            <Button variant="ghost" size="sm" onClick={handleNewEmail} class="mt-2 gap-1">
              <PlusIcon class="size-3.5" />
              <span>Compose email</span>
            </Button>
          }
        />
      }
    >
      <div class="flex flex-col -my-1">
        <For each={emailDrafts()}>
          {(draft) => (
            <DashboardItemRow
              icon={<EnvelopeIcon />}
              iconBg="bg-alert/10 text-alert-ink"
              title={draft.name || 'No subject'}
              subtitle={
                draft.updatedAt ? formatRelativeDate(draft.updatedAt) : undefined
              }
              onClick={() => handleDraftClick(draft)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
