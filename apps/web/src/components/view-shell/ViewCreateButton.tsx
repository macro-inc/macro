import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, type ButtonProps, cn } from '@ui';
import { Show, splitProps } from 'solid-js';
import { ViewSidebar } from './ViewSidebar';

/**
 * Shared desktop New action, including polymorphic dropdown triggers. Inside
 * an `@container/split-header` 600px or narrower it shows only its icon (and
 * its caret, for a menu), as header actions do.
 */
export function ViewCreateButton(
  props: ButtonProps & {
    presentation?: 'sidebar' | 'toolbar';
    menu?: boolean;
    /** The visible label, when the button says more than "New". */
    text?: string;
  }
) {
  const [local, rest] = splitProps(props, [
    'presentation',
    'menu',
    'text',
    'class',
    'children',
    'aria-label',
    'tooltip',
  ]);
  const sidebar = () => local.presentation === 'sidebar';
  const label = () => local['aria-label'] ?? t('create.new');

  return (
    <Button
      {...rest}
      variant="secondary"
      finish="raised"
      size="md"
      aria-label={label()}
      tooltip={sidebar() ? local.tooltip : (local.tooltip ?? label())}
      class={cn(
        sidebar() &&
          'h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left',
        !sidebar() &&
          !local.menu &&
          '@max-[600px]/split-header:w-8 @max-[600px]/split-header:px-0',
        local.class
      )}
    >
      <Show when={sidebar()} fallback={<PlusIcon class="size-4" />}>
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
      </Show>
      <span
        class={cn('truncate', !sidebar() && '@max-[600px]/split-header:hidden')}
      >
        {local.text ?? t('create.new')}
      </span>
      <Show when={local.menu}>
        <Show when={sidebar()} fallback={<CaretDownIcon class="size-3" />}>
          <ViewSidebar.Trailing>
            <CaretDownIcon class="size-3" />
          </ViewSidebar.Trailing>
        </Show>
      </Show>
    </Button>
  );
}
