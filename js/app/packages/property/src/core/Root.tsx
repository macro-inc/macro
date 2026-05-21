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
    },
    portalMount,
  };

  return (
    <PropertyRootContext.Provider value={value}>
      <Dropdown
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        getAnchorRect={() => editorAnchor()?.getBoundingClientRect()}
        gutter={4}
        placement="bottom-start"
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
