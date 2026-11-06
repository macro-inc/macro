import { t } from '@app/lib/i18n';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import UserIcon from '@icon/system/regular/user.svg';
import { Button, Spinner } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';

export type AgentPortraitSource = {
  generate(profile: {
    name: string;
    role: string;
    personality: string;
  }): Promise<string>;
  upload(file: File): Promise<string>;
};

export function AgentPortrait(props: {
  name: string;
  role: string;
  personality: string;
  source: AgentPortraitSource;
  avatar: string;
  onChange(url: string): void;
  onPendingChange(pending: boolean): void;
  children?: JSX.Element;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<
    'agentInvite.profileChanged' | 'agentInvite.photoFailed'
  >();
  let revision = 0;
  let disposed = false;
  let generated = false;
  let picker: HTMLInputElement | undefined;
  onCleanup(() => {
    disposed = true;
    revision += 1;
  });

  const save = async (operation: () => Promise<string>, name?: string) => {
    const current = ++revision;
    setPending(true);
    props.onPendingChange(true);
    setError(undefined);
    try {
      const url = await operation();
      if (
        !disposed &&
        current === revision &&
        (name === undefined || name === props.name.trim())
      )
        props.onChange(url);
      else if (!disposed && current === revision)
        setError('agentInvite.profileChanged');
    } catch {
      if (!disposed && current === revision)
        setError('agentInvite.photoFailed');
    } finally {
      if (!disposed && current === revision) {
        setPending(false);
        props.onPendingChange(false);
      }
    }
  };
  const generate = () => {
    scheduleGeneration.clear();
    if (!props.name.trim() || pending()) return;
    generated = true;
    const profile = {
      name: props.name.trim(),
      role: props.role.trim(),
      personality: props.personality.trim(),
    };
    fireAndForget(
      save(() => props.source.generate(profile), profile.name),
      'team-agent.portrait.generate'
    );
  };
  const scheduleGeneration = debounce(generate, 1000);
  onCleanup(() => scheduleGeneration.clear());
  createEffect(
    on(
      () => props.name.trim(),
      (name) => {
        scheduleGeneration.clear();
        if (!name || generated || untrack(() => !!props.avatar)) {
          props.onPendingChange(untrack(pending));
          return;
        }
        props.onPendingChange(true);
        scheduleGeneration();
      }
    )
  );
  const errorText = () => {
    const key = error();
    return key ? t(key) : undefined;
  };
  const waitingForPhoto = () =>
    pending() || (!!props.name.trim() && !props.avatar && !error());

  return (
    <div class="space-y-2">
      <div class="grid grid-cols-[4rem_minmax(0,1fr)] sm:grid-cols-[5rem_minmax(0,1fr)] items-start gap-4">
        <div class="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-full bg-ink/5 flex items-center justify-center">
          <Show
            when={!waitingForPhoto() || !!props.avatar}
            fallback={
              <div
                role="status"
                aria-label={t('agentInvite.generatingPhoto')}
                class="size-full skeleton-shimmer bg-skeleton"
              />
            }
          >
            <Show
              when={props.avatar}
              fallback={<UserIcon class="size-8 text-ink-muted" />}
            >
              <img
                src={props.avatar}
                alt={t('agentInvite.portrait')}
                class="size-full object-cover"
              />
            </Show>
          </Show>
          <Show when={pending() && !!props.avatar}>
            <div class="absolute inset-0 flex items-center justify-center scrim-glass">
              <Spinner size="md" decorative />
            </div>
          </Show>
        </div>
        <div class="min-w-0 space-y-4">{props.children}</div>
      </div>
      <p class="text-xs text-ink-muted">{t('agentInvite.fictionalFace')}</p>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending() || !props.name.trim()}
          onClick={generate}
        >
          {t('agentInvite.generateAnother')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending()}
          onClick={() => picker?.click()}
        >
          {t('agentInvite.uploadPhoto')}
        </Button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        class="hidden"
        aria-label={t('agentInvite.uploadAgentPhoto')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          scheduleGeneration.clear();
          generated = true;
          fireAndForget(
            save(() => props.source.upload(file)),
            'team-agent.portrait.upload'
          );
        }}
      />
      <Show when={pending()}>
        <p role="status" class="text-xs text-ink-muted">
          {t('agentInvite.preparingPhoto')}
        </p>
      </Show>
      <Show when={error()}>
        <div
          role="alert"
          class="flex flex-wrap items-center gap-2 text-xs text-failure"
        >
          <span>{errorText()}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending() || !props.name.trim()}
            onClick={generate}
          >
            {t('agentInvite.tryAgain')}
          </Button>
        </div>
      </Show>
    </div>
  );
}
