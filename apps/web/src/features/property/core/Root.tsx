import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cn, Dropdown } from '@ui';
import { createSignal, type JSX, onMount, splitProps } from 'solid-js';
import type { Property } from '../types';
import {
  type PropertyEditFn,
  PropertyRootContext,
  type PropertyRootContextValue,
  type PropertySaveFn,
} from './context';

interface PropertyRootProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onSave' | 'property'> {
  property: Property;
  canEdit?: boolean;
  onSave?: PropertySaveFn;
  onEdit?: PropertyEditFn;
  onRefresh?: () => void;
}

export function Root(props: PropertyRootProps) {
  const [local, rest] = splitProps(props, [
    'property',
    'canEdit',
    'onSave',
    'onEdit',
    'onRefresh',
    'class',
    'children',
  ]);

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editorAnchor, setEditorAnchor] = createSignal<HTMLElement | undefined>(
    undefined
  );
  const [portalMount, setPortalMount] = createSignal<HTMLElement | undefined>();

  let rootEl!: HTMLDivElement;
  onMount(() => {
    const scoped = rootEl.closest<HTMLElement>('.portal-scope');
    if (scoped) setPortalMount(scoped);
  });

  // Focus restoration helper - used by both closeEditor and onOpenChange
  // When a value is saved, the component may remount (due to reactive updates),
  // so we fall back to finding the trigger by property ID if the anchor is stale.
  const restoreFocusToAnchor = () => {
    const propertyId = local.property.propertyId;
    const anchor = editorAnchor();

    setTimeout(() => {
      // First try the stored anchor if it's still in the DOM
      if (anchor?.isConnected) {
        anchor.focus();
        return;
      }

      // Fallback: find the trigger by property ID (handles remount case)
      const root = document.querySelector(`[data-property-id="${propertyId}"]`);
      const trigger = root?.querySelector('button');
      if (trigger) {
        trigger.focus();
      }
    }, 0);
  };

  const value: PropertyRootContextValue = {
    property: () => local.property,
    canEdit: () => local.canEdit ?? false,
    get onSave() {
      return local.onSave;
    },
    get onEdit() {
      return local.onEdit;
    },
    get onRefresh() {
      return local.onRefresh;
    },
    editorOpen,
    openEditor: (anchor) => {
      if (anchor) setEditorAnchor(() => anchor);
      setEditorOpen(true);
    },
    closeEditor: () => {
      setEditorOpen(false);
      restoreFocusToAnchor();
    },
    portalMount,
  };

  const handleOpenChange = (open: boolean) => {
    setEditorOpen(open);
    if (!open) {
      restoreFocusToAnchor();
    }
  };

  return (
    <PropertyRootContext.Provider value={value}>
      <Dropdown
        open={editorOpen()}
        onOpenChange={handleOpenChange}
        getAnchorRect={() => editorAnchor()?.getBoundingClientRect()}
        placement={virtualKeyboardVisible() ? 'top-start' : 'bottom-start'}
      >
        <div
          ref={rootEl}
          class={cn('property-root', local.class)}
          data-property
          data-property-id={local.property.propertyId}
          data-property-type={local.property.valueType}
          {...rest}
        >
          {local.children}
        </div>
      </Dropdown>
    </PropertyRootContext.Provider>
  );
}
