import { t } from '@app/lib/i18n';
import RobotIcon from '@icon/system/regular/robot.svg';
import { For, type JSX, Show } from 'solid-js';
import type { GroupSummary } from '../core/model';
import { asksPhrase, neverPhrase } from './labels';
import { PermissionStateGlyph } from './permission-state-glyph';

/**
 * What a collapsed group allows, in words: "60 tools · ⊘ Never deletes ·
 * ✋ Asks before sending · 2 tools customized", or once for the whole group
 * when every action agrees: "60 tools · ✋ Asks for everything".
 */
export function PermissionGroupSummary(props: {
  summary: GroupSummary;
  /** Mention limits set for the current session (the chat card). */
  showSession?: boolean;
}) {
  const parts = (): JSX.Element[] => {
    const summary = props.summary;
    const items: JSX.Element[] = [
      t('agentPermissions.toolCount', { count: summary.toolCount }),
    ];
    const everything = summary.everything;
    if (everything === 'ask' || everything === 'never') {
      items.push(
        <span class="inline-flex items-center gap-1">
          <PermissionStateGlyph state={everything} class="size-3.5" />
          {everything === 'ask'
            ? t('agentPermissions.asksForEverything')
            : t('agentPermissions.neverForEverything')}
        </span>
      );
    }
    const perAction = everything === undefined || everything === 'always';
    for (const action of perAction ? summary.nevers : []) {
      items.push(
        <span class="inline-flex items-center gap-1">
          <PermissionStateGlyph state="never" class="size-3.5" />
          {neverPhrase(action)}
        </span>
      );
    }
    for (const action of perAction ? summary.asks : []) {
      items.push(
        <span class="inline-flex items-center gap-1">
          <PermissionStateGlyph state="ask" class="size-3.5" />
          {asksPhrase(action)}
        </span>
      );
    }
    if (summary.customTools > 0) {
      items.push(
        t('agentPermissions.toolsCustomized', { count: summary.customTools })
      );
    }
    if (summary.byAgent) {
      items.push(
        <span class="inline-flex items-center gap-1">
          <RobotIcon aria-hidden="true" class="size-3.5 text-ink-extra-muted" />
          {t('agentPermissions.restrictedByAgent')}
        </span>
      );
    }
    if (props.showSession && summary.sessionLimited) {
      items.push(t('agentPermissions.sessionLimited'));
    }
    if (items.length === 1) items.push(t('agentPermissions.allAllowed'));
    return items;
  };

  return (
    <span class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
      <For each={parts()}>
        {(part, index) => (
          <>
            <Show when={index() > 0}>
              <span aria-hidden="true" class="text-ink-disabled">
                ·
              </span>
            </Show>
            <span class="text-ink">{part}</span>
          </>
        )}
      </For>
    </span>
  );
}
