import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import Chat from '@icon/system/regular/chat.svg';
import * as Popover from '@kobalte/core/popover';
import { Button, CountBadge } from '@ui';
import { For, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { usePrPage } from '../../context/pr-page-context';
import type { PrPageReviewer } from '../../context/pr-page-read-model';

type ReviewVerdict = Extract<
  PrPageReviewer['state'],
  'approved' | 'changes_requested' | 'commented'
>;

export function PrReviewForm(props: { onSubmit?: () => void }) {
  const { actions, page } = usePrPage();
  const flow = useFlow();
  const [draft, setDraft] = createStore<{
    body: string;
    verdict: ReviewVerdict;
    pending: boolean;
  }>({ body: '', verdict: 'commented', pending: false });
  const options = () => {
    const choices: { value: ReviewVerdict; label: string }[] = [
      { value: 'commented', label: t('prPage.comment') },
    ];
    if (!page()?.viewerIsAuthor) {
      choices.push(
        { value: 'approved', label: t('prPage.approve') },
        { value: 'changes_requested', label: t('prPage.requestChanges') }
      );
    }
    return choices;
  };
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const valid = () => {
    if (page()?.viewerIsAuthor && draft.verdict !== 'commented') return false;
    return (
      draft.verdict !== 'changes_requested' || draft.body.trim().length > 0
    );
  };
  const submit = async () => {
    if (!valid() || draft.pending || !actions.submitReview.run) return;
    setDraft('pending', true);
    try {
      await flow.task('pr.submit-review', async () => {
        await actions.submitReview.run?.(draft.verdict, draft.body.trim());
      });
      if (!active) return;
      setDraft('body', '');
      props.onSubmit?.();
    } finally {
      setDraft('pending', false);
    }
  };
  return (
    <Show when={actions.submitReview.available()}>
      <form
        class="flex flex-col gap-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(submit(), 'pr-submit-review');
        }}
      >
        <h2 class="text-sm font-medium">{t('prPage.review')}</h2>
        <textarea
          class="min-h-28 w-full rounded-lg bg-input p-3 text-sm"
          aria-label={t('prPage.reviewBody')}
          placeholder={t('prPage.reviewBody')}
          value={draft.body}
          readOnly={draft.pending}
          onInput={(event) => setDraft('body', event.currentTarget.value)}
        />
        <fieldset class="flex flex-col gap-2">
          <legend class="sr-only">{t('prPage.review')}</legend>
          <For each={options()}>
            {(option) => (
              <label class="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pr-review-verdict"
                  checked={draft.verdict === option.value}
                  disabled={draft.pending}
                  onChange={() => setDraft('verdict', option.value)}
                />
                {option.label}
              </label>
            )}
          </For>
        </fieldset>
        <Show when={page()?.pendingComments.length}>
          <div class="flex flex-col gap-2 text-xs text-ink-muted">
            <span>
              {t('prPage.pendingReview')} ({page()?.pendingComments.length})
            </span>
            <For each={page()?.pendingComments}>
              {(comment) => (
                <div class="flex min-w-0 flex-col gap-1 rounded-md bg-hover p-2">
                  <span class="truncate font-mono">{comment.path}</span>
                  <span class="truncate">{comment.body}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Button size="sm" type="submit" disabled={!valid() || draft.pending}>
          {t('prPage.submitReview')}
        </Button>
      </form>
    </Show>
  );
}

export function PrFinishReviewPopover() {
  const { actions, page } = usePrPage();
  const [state, setState] = createStore({ open: false });
  return (
    <Show when={actions.submitReview.available()}>
      <Popover.Root
        open={state.open}
        onOpenChange={(open) => setState('open', open)}
        placement="top-end"
      >
        <Popover.Trigger as={Button} size="sm">
          <Chat class="size-4" />
          {t('prPage.review')}
          <Show when={page()?.pendingComments.length}>
            <CountBadge count={page()?.pendingComments.length ?? 0} />
          </Show>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            class="menu-surface z-modal w-80 max-w-[90vw] rounded-xl"
            aria-label={t('prPage.review')}
          >
            <PrReviewForm onSubmit={() => setState('open', false)} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Show>
  );
}

export function PrCommentForm() {
  const { actions } = usePrPage();
  const flow = useFlow();
  const [draft, setDraft] = createStore({ body: '', pending: false });
  const submit = async () => {
    if (!draft.body.trim() || draft.pending || !actions.comment.run) return;
    setDraft('pending', true);
    try {
      await flow.task('pr.comment', async () => {
        await actions.comment.run?.(draft.body.trim());
      });
      setDraft('body', '');
    } finally {
      setDraft('pending', false);
    }
  };
  return (
    <Show when={actions.comment.available()}>
      <form
        class="flex flex-col gap-3 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(submit(), 'pr-comment');
        }}
      >
        <textarea
          aria-label={t('prPage.commentPlaceholder')}
          placeholder={t('prPage.commentPlaceholder')}
          class="min-h-24 w-full rounded-lg bg-input p-3 text-sm"
          value={draft.body}
          readOnly={draft.pending}
          onInput={(event) => setDraft('body', event.currentTarget.value)}
        />
        <div class="flex justify-end">
          <Button
            size="sm"
            type="submit"
            disabled={!draft.body.trim() || draft.pending}
          >
            {t('prPage.postComment')}
          </Button>
        </div>
      </form>
    </Show>
  );
}
