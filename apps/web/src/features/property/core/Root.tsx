import { useHoldParentHoverCardOpen } from '@core/component/HoverCard';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cn, Dropdown } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  splitProps,
  untrack,
} from 'solid-js';
import type { Property, PropertyApiValues } from '../types';
import { withApiValues } from '../utils/transforms';
import {
  type PropertyEditFn,
  PropertyRootContext,
  type PropertyRootContextValue,
  type PropertySaveFn,
} from './context';

interface PropertyRootProps
  extends Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'onSave' | 'property' | 'children'
  > {
  property: Property;
  canEdit?: boolean;
  onSave?: PropertySaveFn;
  onEdit?: PropertyEditFn;
  /** A function receives the property as shown, including a pick still saving. */
  children?: JSX.Element | ((property: Accessor<Property>) => JSX.Element);
}

/**
 * A pick the source has not shown yet. `base` is unset while the save runs;
 * after it succeeds, the pick stays until the source emits a newer property.
 * The definition ID survives a new property's ID assignment mid-save, but not
 * a Root that is reused for another property.
 */
type PendingValue = {
  value: PropertyApiValues;
  propertyDefinitionId: string;
  base?: Property;
};

export function Root(props: PropertyRootProps) {
  const [local, rest] = splitProps(props, [
    'property',
    'canEdit',
    'onSave',
    'onEdit',
    'class',
    'children',
  ]);

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editorAnchor, setEditorAnchor] = createSignal<HTMLElement | undefined>(
    undefined
  );

  useHoldParentHoverCardOpen(editorOpen);

  // Editors close before their save finishes, and the source only catches up
  // once the cache projects the write, so show the pick until then.
  const [pending, setPending] = createSignal<PendingValue>();
  const property = createMemo(() => {
    const current = pending();
    return current &&
      current.propertyDefinitionId === local.property.propertyDefinitionId &&
      (current.base === undefined || current.base === local.property)
      ? withApiValues(local.property, current.value)
      : local.property;
  });

  const save: PropertySaveFn = async (saved, value) => {
    const onSave = local.onSave;
    if (!onSave) return;
    const entry: PendingValue = {
      value,
      propertyDefinitionId: saved.propertyDefinitionId,
    };
    setPending(entry);
    try {
      await onSave(saved, value);
      if (pending() === entry) setPending({ ...entry, base: local.property });
    } catch (error) {
      if (pending() === entry) setPending(undefined);
      throw error;
    }
  };

  // A touch editor leaves focus in the field the user was typing in (a
  // composer's title), and a picker sheet hands it back there.
  let focusAtOpen: Element | null = null;

  // Focus restoration helper - used by both closeEditor and onOpenChange
  // When a value is saved, the component may remount (due to reactive updates),
  // so we fall back to finding the trigger by property ID if the anchor is stale.
  const restoreFocusToAnchor = () => {
    const propertyId = local.property.propertyId;
    const anchor = editorAnchor();
    const focusedAtOpen = focusAtOpen;

    setTimeout(() => {
      // Focus is back where the editor found it; moving it to the pill would
      // drop the phone keyboard.
      if (
        focusedAtOpen &&
        focusedAtOpen !== document.body &&
        document.activeElement === focusedAtOpen
      )
        return;

      // First try the stored anchor if it's still in the DOM
      if (anchor?.isConnected) {
        anchor.focus();
        return;
      }

      // Fallback: find the trigger by property ID (handles remount case)
      const root = document.querySelector(`[data-property-id="${propertyId}"]`);
      // Row actions can precede the value editor; restore focus to its trigger.
      const trigger = root?.querySelector<HTMLButtonElement>(
        'button:not([data-property-row-action])'
      );
      if (trigger) {
        trigger.focus();
      }
    }, 0);
  };

  const value: PropertyRootContextValue = {
    property,
    canEdit: () => local.canEdit ?? false,
    get onSave() {
      return local.onSave && save;
    },
    get onEdit() {
      return local.onEdit;
    },
    editorOpen,
    openEditor: (anchor) => {
      focusAtOpen = document.activeElement;
      if (anchor) setEditorAnchor(() => anchor);
      setEditorOpen(true);
    },
    closeEditor: () => {
      setEditorOpen(false);
      restoreFocusToAnchor();
    },
  };

  const children = () => {
    const content = local.children;
    return typeof content === 'function'
      ? untrack(() => content(property))
      : content;
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
        fitViewport
      >
        <div
          class={cn('property-root', local.class)}
          data-property
          data-property-id={local.property.propertyId}
          data-property-type={local.property.valueType}
          {...rest}
        >
          {children()}
        </div>
      </Dropdown>
    </PropertyRootContext.Provider>
  );
}
