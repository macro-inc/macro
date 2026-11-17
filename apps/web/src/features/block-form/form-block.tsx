import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
/**
 * App-facing entry for the `form` block. It reads the legacy block state once
 * (id, params, split) and hands identity, capabilities and host actions to
 * the feature through `FormProvider` and props (FE-34). The block's access
 * level is the form's own (`queries/load-form.ts`), so the header badge and
 * the share dialog agree with what the service answered.
 */

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  returnSplitToRecentListView,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { enableForms } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { getWebOrigin } from '@core/util/webOrigin';
import { useFormSharePermissionsQuery } from '@queries/storage/forms';
import { createSignal, Show } from 'solid-js';
import type { FormTab } from './components/form-tabs';
import { FormProvider } from './context/form-context';
import { primaryAction } from './core/form-status';
import { respondLink } from './core/respond-link';
import { createAppFormContext } from './form-context-production';
import { createFormShareInput } from './form-global-sharing';
import { reservePreviewTab } from './form-preview-tab';
import { createPreview } from './primitives/create-preview';
import { FormBlockHeader } from './views/form-block-header';
import { FormCardView } from './views/form-card-view';
import { type FormHeaderProps, FormPageView } from './views/form-page-view';
import { MobileFormBlockHeader } from './views/mobile/form-block-header';
import { RespondView } from './views/respond-view';
import type { FormBlockHeaderProps } from './views/shared/form-block-header-parts';

function FormHeader(props: FormHeaderProps) {
  return (
    <SplitHeaderLeft>
      <div class="ml-2 min-w-0 max-w-xl shrink">{props.tabs}</div>
    </SplitHeaderLeft>
  );
}

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
    openCalendarSettings: () =>
      insertSplit({ type: 'component', id: 'booking-links' }),
  });
  const source = context.createFormSource(
    () => formId,
    () => !props.respondOnly
  );
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
  // Sharing a form hands out its respond link; editors copy theirs apart.
  const copyEntityLink = useCopyLink();
  const copyRespondLink = () =>
    fireAndForget(copyEntityLink(link()), 'form-share');
  const shareInput = createFormShareInput({
    formId: () => formId,
    detail: source.detail,
    updateMetadata: context.updateMetadata,
    notify: context.notify,
  });
  const openShare = useShareModal(shareInput);
  const openRespond = () => openExternalUrl(link());
  // The preview reads the form, so it waits for every edit to reach it.
  const preview = createPreview({
    reserveTab: reservePreviewTab,
    url: () => `${link()}?preview=true`,
    notify: context.notify,
  });
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
  const headerProps: FormBlockHeaderProps = {
    formId,
    detail: source.detail,
    name,
    get respondOnly() {
      return props.respondOnly;
    },
    published,
    preview,
    openShare,
    openRespond,
    copyRespondLink,
  };
  let respondScroll: HTMLDivElement | undefined;
  return (
    <FormProvider value={context}>
      <Show
        when={isTouchDevice()}
        fallback={<FormBlockHeader {...headerProps} />}
      >
        <MobileFormBlockHeader {...headerProps} />
      </Show>
      <Show
        when={props.respondOnly}
        fallback={
          <FormPageView
            // The touch header has no room for tabs beside the actions.
            header={isTouchDevice() ? undefined : FormHeader}
            source={source}
            tab={tab()}
            respondLink={link()}
            preview={preview}
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

/** Nested in a message or document: the card body, no page chrome. */
function FormCardContent() {
  const formId = useBlockId();
  const { insertSplit } = useSplitLayout();
  const context = createAppFormContext({
    openRelated: (destination) =>
      insertSplit({ type: 'database', id: destination.databaseId }),
    openChannel: (channelId) => insertSplit({ type: 'channel', id: channelId }),
    openCalendarSettings: () =>
      insertSplit({ type: 'component', id: 'booking-links' }),
  });
  const source = context.createFormSource(() => formId);
  const open = () => {
    const detail = source.detail();
    insertSplit(
      detail?.access === 'view'
        ? { type: 'form', id: formId, params: { view: 'respond' } }
        : { type: 'form', id: formId }
    );
  };
  return (
    <FormProvider value={context}>
      <Show
        when={source.detail()}
        fallback={
          <Show
            when={source.failure()}
            fallback={<ListSkeleton.Bar class="h-24 w-full rounded-xl" />}
          >
            <p class="p-3 text-sm text-ink-muted">This form isn’t available.</p>
          </Show>
        }
      >
        {(detail) => (
          <FormCardView
            detail={detail()}
            refetch={source.refetch}
            narrow={isMobile()}
            onOpen={open}
            onOpenResponses={() =>
              insertSplit({
                type: 'form',
                id: formId,
                params: { view: 'responses' },
              })
            }
          />
        )}
      </Show>
    </FormProvider>
  );
}

export default function FormBlock(props: { view?: unknown }) {
  const flag = useFeatureFlag(enableForms);
  const nested = useIsNestedBlock();
  // The flag gates authoring only: with it off, a form opens on its respond
  // view, and the service decides who may answer.
  return (
    <Show when={!nested} fallback={<FormCardContent />}>
      <DocumentBlockContainer>
        <div class="size-full">
          <FormBlockContent
            respondOnly={props.view === 'respond' || !flag().enabled}
            initialTab={
              props.view === 'responses' || props.view === 'share'
                ? props.view
                : undefined
            }
          />
        </div>
      </DocumentBlockContainer>
    </Show>
  );
}
