import { t } from '@app/lib/i18n';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import Check from '@icon/system/regular/check.svg';
import GitMerge from '@icon/system/regular/git-merge.svg';
import TerminalWindow from '@icon/system/regular/terminal-window.svg';
import {
  useSessionAutoArchiveQuery,
  useSetSessionAutoArchiveMutation,
} from '@queries/agent-session/auto-archive';
import type {
  AutoArchivePreferencesBody,
  SessionAutoArchiveResponse,
} from '@service-agent-harness/client';
import type { Accessor, Component } from 'solid-js';
import { match } from 'ts-pattern';

type Trigger = keyof AutoArchivePreferencesBody;
type Choice = 'default' | 'on' | 'off';

const choiceOf = (override: boolean | null | undefined): Choice => {
  if (override === null || override === undefined) return 'default';
  return override ? 'on' : 'off';
};

const overrideFor = (choice: Choice): boolean | null =>
  match(choice)
    .with('default', () => null)
    .with('on', () => true)
    .with('off', () => false)
    .exhaustive();

/** Keeps unchecked choices aligned with the checked one. */
function NoIcon() {
  return <span class="size-4 shrink-0" aria-hidden="true" />;
}

/**
 * The owner's per-session auto-archive choices, one submenu per trigger. Empty
 * when `enabled` is false: not the owner, or the session is or was archived,
 * since a session archives itself at most once.
 */
export function useAutoArchiveFileOperations(props: {
  sessionId: Accessor<string | undefined>;
  enabled: Accessor<boolean>;
}): Accessor<FileOperation[]> {
  const autoArchive = useSessionAutoArchiveQuery(() =>
    props.enabled() ? props.sessionId() : undefined
  );
  const setOverrides = useSetSessionAutoArchiveMutation();

  const choose = async (
    sessionId: string,
    current: SessionAutoArchiveResponse,
    trigger: Trigger,
    choice: Choice
  ) => {
    try {
      await setOverrides.mutateAsync({
        sessionId,
        overrides: { ...current.overrides, [trigger]: overrideFor(choice) },
      });
    } catch {
      toast.failure(t('entityActions.toastAutoArchiveFailed'));
    }
  };

  const triggerMenu = (
    sessionId: string,
    current: SessionAutoArchiveResponse,
    trigger: Trigger,
    label: string,
    icon: Component
  ): FileOperation => {
    const selected = choiceOf(current.overrides[trigger]);
    const choices: { choice: Choice; label: string }[] = [
      {
        choice: 'default',
        label: current.defaults[trigger]
          ? t('entityActions.autoArchiveUseDefaultOn')
          : t('entityActions.autoArchiveUseDefaultOff'),
      },
      { choice: 'on', label: t('entityActions.autoArchiveOn') },
      { choice: 'off', label: t('entityActions.autoArchiveOff') },
    ];
    return {
      label,
      icon,
      children: choices.map((option) => ({
        label: option.label,
        icon: option.choice === selected ? Check : NoIcon,
        action: () =>
          fireAndForget(
            choose(sessionId, current, trigger, option.choice),
            'agent-session-auto-archive'
          ),
      })),
    };
  };

  return () => {
    const sessionId = props.sessionId();
    if (!sessionId || !props.enabled() || !autoArchive.isSuccess) return [];
    const current = autoArchive.data;
    if (current.archived) return [];
    return [
      triggerMenu(
        sessionId,
        current,
        'onPullRequestMerged',
        t('entityActions.archiveWhenPullRequestsMerge'),
        GitMerge
      ),
      triggerMenu(
        sessionId,
        current,
        'onRuntimeClosed',
        t('entityActions.archiveWhenSessionCloses'),
        TerminalWindow
      ),
    ];
  };
}
