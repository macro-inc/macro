import { openProject } from '@app/features/projects/open-project';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ProjectIcon from '@icon/system/regular/stack.svg';
import { ButtonGroup, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useProperty } from '../core/context';
import { usePropertyEntityDisplay } from '../hooks';
import type { Property as PropertyValue } from '../types';
import { getEntityValues } from '../utils';

/**
 * A task's project as a split pill: the name opens the project and the caret
 * changes it. An empty or unavailable project stays the plain `fallback` pill.
 * A project still loading keeps the split, so a pick doesn't remount the caret
 * that takes focus back when the picker closes. The name counts as a row action
 * so that focus returns to the caret when the first project replaces the pill.
 */
export function ProjectLinkPill(props: {
  property: PropertyValue;
  fallback: JSX.Element;
  class?: string;
  variant?: 'secondary' | 'ghost';
}) {
  const ctx = useProperty();
  const layout = useSplitLayout();
  const variant = () => props.variant ?? 'secondary';
  const reference = () => getEntityValues(props.property)[0];
  const { name, nativeProjectId, isLoading } = usePropertyEntityDisplay(
    () => reference()?.entity_id ?? '',
    () => 'INITIATIVE'
  );
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    const id = nativeProjectId();
    if (id) openProject(layout, id, { newSplit: event.shiftKey });
  };

  return (
    <Show
      when={reference() && (isLoading() || nativeProjectId())}
      fallback={props.fallback}
    >
      <ButtonGroup
        finish={variant() === 'secondary' ? 'raised' : undefined}
        variant={variant()}
        size="xs"
        class={cn('min-w-0 max-w-full border-0', props.class)}
      >
        <ButtonGroup.Button
          data-property-row-action
          aria-label={t('entityActions.openProjectNamed', { name: name() })}
          class="group/project-link min-w-0 shrink justify-start"
          onClick={open}
        >
          <ProjectIcon class="size-3 shrink-0 not-touch:group-hover/project-link:hidden not-touch:group-focus-visible/project-link:hidden" />
          <ArrowUpRightIcon class="hidden size-3 shrink-0 not-touch:group-hover/project-link:block not-touch:group-focus-visible/project-link:block" />
          <span class="min-w-0 max-w-60 truncate">{name()}</span>
        </ButtonGroup.Button>
        <Show when={ctx.canEdit()}>
          <ButtonGroup.Divider />
          <ButtonGroup.Button
            size="icon-xs"
            aria-label={t('entityActions.changeProject')}
            aria-expanded={ctx.editorOpen()}
            onClick={(event) => {
              event.stopPropagation();
              ctx.openEditor(event.currentTarget);
            }}
          >
            <CaretDownIcon class="size-3 shrink-0" />
          </ButtonGroup.Button>
        </Show>
      </ButtonGroup>
    </Show>
  );
}
