import { t } from '@app/lib/i18n';
import SourceIcon from '@icon/system/regular/link.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { Property } from '../types';
import { EntityLinkPill } from './EntityLinkPill';

/** The item opens through the mention-link path; the caret edits the reference. */
export function SourceLinkPill(props: {
  property: Property;
  fallback: JSX.Element;
  class?: string;
  iconClass?: string;
  variant?: 'secondary' | 'ghost';
  showSourceIcon?: boolean;
}) {
  return (
    <EntityLinkPill
      property={props.property}
      fallback={props.fallback}
      class={props.class}
      iconClass={props.iconClass}
      variant={props.variant}
      openLabel={(name) => t('entityActions.openSourceNamed', { name })}
      changeLabel={t('entityActions.changeSource')}
      leadingIcon={
        <Show when={props.showSourceIcon !== false}>
          <SourceIcon
            class={cn('size-3 shrink-0 text-ink-muted', props.iconClass)}
          />
        </Show>
      }
    />
  );
}
