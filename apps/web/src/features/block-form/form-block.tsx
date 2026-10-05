/**
 * App-facing entry for the `form` block. It reads the legacy block state once
 * (id, params, split) and hands identity, capabilities and host actions to
 * the feature through `FormProvider` and props (FE-34). The block's access
 * level is the form's own (`queries/load-form.ts`), so the header badge and
 * the share dialog agree with what the service answered.
 */

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ResponsivePermissionsBadge } from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  returnSplitToRecentListView,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { enableForms } from '@core/constant/featureFlags';
import { getWebOrigin } from '@core/util/webOrigin';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import { useFormSharePermissionsQuery } from '@queries/storage/forms';
import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import type { FormTab } from './components/form-tabs';
import { AudiencePanel } from './components/share/audience-panel';
import { FormProvider } from './context/form-context';
import { primaryAction } from './core/form-status';
import { respondLink } from './core/respond-link';
import { createAppFormContext } from './form-context-production';
import { createAudienceChange } from './primitives/create-audience-change';
import { FormPageView } from './views/form-page-view';
import { RespondView } from './views/respond-view';

function FormBlockContent(props: {
  respondOnly: boolean;
  initialTab: FormTab | undefined;
}) {
  const formId = useBlockId();
  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const context = createAppFormContext({
    openRelated: (destination) =>
      replaceOrInsertSplit({ type: 'database', id: destination.databaseId }),
    openChannel: (channelId) => insertSplit({ type: 'channel', id: channelId }),
  });
  const source = context.createFormSource(() => formId);
  const summary = context.responses.createSummary(
    () => formId,
    () => {
      const access = source.detail()?.access;
      return access === 'edit' || access === 'owner';
    }
  );
  // Each split keeps its own tab, opened on the split's `view` param; the
  // page-wide hash would leak one form's tab into another split.
  const [tab, changeTab] = createSignal<FormTab>(props.initialTab ?? 'build');
  // Shared links open on the web, even from the desktop app (whose own
  // router base is `/`), so the base is the web app's.
  const link = () => respondLink(`${getWebOrigin()}/app/`, formId);
  const audience = createAudienceChange({
    detail: source.detail,
    updateMetadata: context.updateMetadata,
    notify: context.notify,
  });
  // The share dialog mounts outside this block, so the panel takes plain props.
  const AudienceForShare = () => (
    <Show when={source.detail()}>
      {(detail) => (
        <AudiencePanel
          audience={detail().form.audience}
          canChange={detail().access === 'owner'}
          respondLink={link()}
          pending={audience.pending()}
          onChange={(next) => void audience.change(next)}
        />
      )}
    </Show>
  );
  const openShare = useShareModal(() => {
    const detail = source.detail();
    if (!detail) return;
    return {
      id: formId,
      blockAlias: 'form',
      itemType: 'form',
      name: detail.form.name,
      owner: detail.form.ownerId,
      // The form's own access, as the service answered it: owners manage sharing.
      userPermissions: getPermissions(detail.access),
      audience: AudienceForShare,
    };
  });
  const openRespond = () =>
    insertSplit({ type: 'form', id: formId, params: { view: 'respond' } });
  const shares = useFormSharePermissionsQuery(
    () => formId,
    () => source.detail()?.access === 'owner'
  );
  const shared = () =>
    shares.isSuccess
      ? (shares.data.channelSharePermissions ?? []).length > 0 ||
        !!shares.data.teamShareAccessLevel
      : undefined;
  // Only owners publish (share); other editors open the respond view.
  const published = () => {
    const detail = source.detail();
    if (!detail) return false;
    if (detail.access !== 'owner') return true;
    const counts = summary.value();
    return (
      primaryAction({
        audience: detail.form.audience,
        responses: counts ? counts.submitted + counts.stopped : 0,
        shared: shared(),
      }) === 'open'
    );
  };
  const name = () => source.detail()?.form.name ?? 'Form';
  const primary = (): JSX.Element => (
    <Show
      when={published()}
      fallback={
        <Button variant="cta" size="sm" onClick={openShare}>
          <PaperPlaneTilt class="size-3.5" />
          Publish
        </Button>
      }
    >
      <Button variant="outline" size="sm" onClick={openRespond}>
        <ArrowSquareOut class="size-3.5" />
        Open form
      </Button>
    </Show>
  );
  let respondScroll: HTMLDivElement | undefined;
  return (
    <FormProvider value={context}>
      <SplitHeaderLeft>
        <BlockItemSplitLabel name={name} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
        <div class="order-[1000] flex items-center gap-1.5">
          <Show
            when={
              !props.respondOnly &&
              source.detail() &&
              source.detail()?.access !== 'view'
            }
          >
            {primary()}
          </Show>
          <ShareTrigger onClick={openShare} />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <Show
        when={props.respondOnly}
        fallback={
          <FormPageView
            source={source}
            tab={tab()}
            respondLink={link()}
            onTabChange={changeTab}
            onOpenDatabase={(databaseId) =>
              replaceOrInsertSplit({ type: 'database', id: databaseId })
            }
            onOpenShare={openShare}
            onTrashed={() => returnSplitToRecentListView(panel.handle)}
          />
        }
      >
        <div
          ref={respondScroll}
          class="h-full min-h-0 overflow-y-auto bg-canvas-base touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
        >
          <Show when={source.detail()}>
            {(detail) => (
              <RespondView
                detail={detail()}
                refetch={source.refetch}
                compact={false}
                scrollContainer={() => respondScroll}
              />
            )}
          </Show>
        </div>
      </Show>
    </FormProvider>
  );
}

export default function FormBlock(props: { view?: unknown }) {
  const flag = useFeatureFlag(enableForms);
  // The flag gates authoring only: with it off, a form opens on its respond
  // view, and the service decides who may answer.
  return (
    <DocumentBlockContainer>
      <FormBlockContent
        respondOnly={
          props.view === 'respond' || (!flag().enabled && !flag().loading)
        }
        initialTab={
          props.view === 'responses' || props.view === 'share'
            ? props.view
            : undefined
        }
      />
    </DocumentBlockContainer>
  );
}
