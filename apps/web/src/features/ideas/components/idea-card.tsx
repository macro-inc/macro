import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { RoutineIdeaText } from '../context/ideas-source';
import type { Idea, IdeaStatus } from '../core/idea';
import { IdeaTile } from './idea-tile';

function StateBadge(props: { idea: Idea; status: IdeaStatus }) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Badge variant="secondary" size="xs">
          <Spinner size="sm" decorative class="size-3" />
          {t('ideas.badgeRunning')}
        </Badge>
      </Match>
      <Match when={props.status === 'failed'}>
        <Badge variant="secondary" size="xs">
          <WarningIcon class="size-3 text-failure" />
          {t('ideas.badgeFailed')}
        </Badge>
      </Match>
      <Match when={props.status === 'done'}>
        <Badge variant="secondary" size="xs">
          <CheckIcon class="size-3 text-success" />
          {t('ideas.badgeDone')}
        </Badge>
      </Match>
      <Match when={props.idea.kind === 'routine'}>
        <Badge variant="outline" size="xs">
          {t('ideas.badgeRoutine')}
        </Badge>
      </Match>
    </Switch>
  );
}

/** What a background run will post or send, said before Run. */
function RunEffects(props: { sends: string | undefined }) {
  return (
    <p class="flex min-w-0 items-start gap-2 text-sm text-ink">
      <PaperPlaneIcon
        class="mt-0.5 size-4 shrink-0"
        classList={{
          'text-warning': !!props.sends,
          'text-ink-extra-muted': !props.sends,
        }}
      />
      <span class="min-w-0" data-idea-sends>
        {props.sends ?? t('ideas.sendsNothing')}
      </span>
    </p>
  );
}

/** A routine's sentence, with the values AI picked in violet. */
function RoutineSentence(props: { text: RoutineIdeaText }) {
  return (
    <>
      <p class="text-[15px] leading-7 text-ink-muted">
        <For each={props.text.sentence}>
          {(part) => (
            <Show when={part.picked} fallback={part.text}>
              <span class="rounded-sm px-0.5 font-medium text-violet-ink underline decoration-2 underline-offset-4">
                {part.text}
              </span>
            </Show>
          )}
        </For>
      </p>
      <p class="flex items-center gap-1 text-xs text-ink-extra-muted">
        <LightningIcon class="size-3.5 text-violet-ink" />
        {props.text.when}
      </p>
    </>
  );
}

function IdeaBody(props: { idea: Idea; routine?: RoutineIdeaText }) {
  return (
    <Switch>
      <Match when={props.idea.kind === 'prompt' && props.idea} keyed>
        {(prompt) => (
          <>
            <p
              class="rounded-lg bg-ink/[0.03] px-3 py-2 text-sm leading-6 text-ink-muted"
              aria-label={t('ideas.promptLabel')}
            >
              “{prompt.prompt}”
            </p>
            <Show when={prompt.runMode === 'background' && prompt} keyed>
              {(background) => <RunEffects sends={background.sends} />}
            </Show>
          </>
        )}
      </Match>
      <Match when={props.idea.kind === 'entity' && props.idea.draft}>
        <p class="text-sm text-ink-muted">{t('ideas.draftReady')}</p>
      </Match>
      <Match when={props.idea.kind === 'routine' && props.routine} keyed>
        {(text) => <RoutineSentence text={text} />}
      </Match>
    </Switch>
  );
}

export type IdeaCardProps = {
  idea: Idea;
  status: IdeaStatus;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  /** Ringed: the idea the person came here for. */
  focused: boolean;
  routine?: RoutineIdeaText;
  onAccept(): void;
  onOpen(): void;
  onReview(): void;
  onDismiss(): void;
};

function CardActions(props: IdeaCardProps): JSX.Element {
  const acceptLabel = () => {
    const idea = props.idea;
    if (idea.kind === 'routine') return t('ideas.turnOn');
    if (idea.kind === 'entity') {
      return idea.draft ? t('ideas.openDraft') : t('ideas.openItem');
    }
    if (idea.runMode === 'composer') return t('ideas.run');

    return props.status === 'failed'
      ? t('ideas.runAgain')
      : t('ideas.runInBackground');
  };
  const isBackground = () =>
    props.idea.kind === 'prompt' && props.idea.runMode === 'background';

  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Button variant="ghost" size="sm" onClick={props.onOpen}>
          {t('ideas.viewProgress')}
        </Button>
      </Match>
      <Match when={props.status === 'done'}>
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          {isBackground() ? t('ideas.openResult') : t('ideas.openItem')}
        </Button>
      </Match>
      <Match when={props.status === 'open' || props.status === 'failed'}>
        <Show when={props.idea.kind === 'routine'}>
          <Button variant="ghost" size="sm" onClick={props.onReview}>
            {t('ideas.review')}
          </Button>
        </Show>
        <Button
          variant="primary"
          size="sm"
          loading={props.busy}
          onClick={props.onAccept}
          data-idea-accept
        >
          <Show when={isBackground()}>
            <PlayIcon class="size-3.5" />
          </Show>
          {acceptLabel()}
        </Button>
      </Match>
    </Switch>
  );
}

/** One idea, in the routine step's language: tile, title, state, one action. */
export function IdeaCard(props: IdeaCardProps) {
  const titleId = () => `idea-title-${props.idea.id}`;

  return (
    <Card
      role="article"
      variant="filled"
      aria-labelledby={titleId()}
      data-idea={props.idea.id}
      data-idea-status={props.status}
      class={
        props.focused ? 'gap-2.5 p-4 ring-2 ring-accent/60' : 'gap-2.5 p-4'
      }
    >
      <header class="flex min-w-0 items-center gap-2.5">
        <IdeaTile idea={props.idea} />
        <Show when={props.isNew}>
          <span
            class="size-1.5 shrink-0 rounded-full bg-violet"
            role="img"
            aria-label={t('ideas.newIdea')}
          />
        </Show>
        <h2
          id={titleId()}
          class="min-w-0 truncate text-[15px] font-medium text-ink"
        >
          {props.idea.title}
        </h2>
        <StateBadge idea={props.idea} status={props.status} />
        <Button
          class="ml-auto shrink-0"
          variant="ghost"
          size="icon-sm"
          aria-label={t('ideas.dismissIdea', { title: props.idea.title })}
          tooltip={t('ideas.dismiss')}
          onClick={props.onDismiss}
        >
          <CloseIcon class="size-4" />
        </Button>
      </header>
      <div class="flex min-w-0 flex-col gap-2.5 pl-9.5">
        <Show when={props.idea.summary}>
          <p class="text-sm leading-6 text-ink-muted">{props.idea.summary}</p>
        </Show>
        <IdeaBody idea={props.idea} routine={props.routine} />
        <Show when={props.status === 'failed'}>
          <p class="text-sm text-failure">{t('ideas.runFailed')}</p>
        </Show>
        <Show when={props.failed}>
          <p role="alert" class="text-sm text-failure">
            {t('ideas.actionFailed')}
          </p>
        </Show>
        <div class="flex min-w-0 items-center justify-end gap-2">
          <CardActions {...props} />
        </div>
      </div>
    </Card>
  );
}

/** A dismissed idea, until the person leaves: one line and Undo. */
export function DismissedIdea(props: { idea: Idea; onUndo(): void }) {
  return (
    <div
      class="flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-edge-muted px-4 py-2.5 text-sm text-ink-muted"
      data-idea-dismissed={props.idea.id}
    >
      <EyeSlashIcon class="size-4 shrink-0" />
      <p class="min-w-0 flex-1 truncate">
        {t('ideas.dismissed', { title: props.idea.title })}
      </p>
      <Button variant="ghost" size="sm" onClick={props.onUndo}>
        {t('ideas.undo')}
      </Button>
    </div>
  );
}
