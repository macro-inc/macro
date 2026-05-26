// Composable property component namespace.
//
// Mirrors @entity: small extractors compose under <Property.Root> to render
// property values in any layout, replacing the duplicated PropertyValue /
// CondensedPropertyValue / InlinePropertyValue / ListPropertyValue trees.

import {
  PropertyDisplay,
  PropertyDisplayCondensed,
} from './composed/PropertyDisplay';
import { Layout } from './core/Layout';
import { Root } from './core/Root';
import { Slot } from './core/Slot';
import {
  InlineBooleanEditor,
  InlineEditor,
  InlineLinkEditor,
  InlineNumberEditor,
  InlineTextEditor,
  PopoverEditor,
  PropertyEditor,
} from './editors';
import { EditorPopover } from './editors/popover/EditorPopover';
import {
  PropertyAddButton,
  PropertyCaret,
  PropertyChips,
  PropertyEditTrigger,
  PropertyEmpty,
  PropertyIcon,
  PropertyLabel,
  PropertyRemoveButton,
  PropertyText,
  PropertyTooltip,
  PropertyUserStack,
} from './extractors';

export const Property = {
  Root,
  Layout,
  Slot,

  // Display extractors — take property as a prop, render no behavior.
  Icon: PropertyIcon,
  Label: PropertyLabel,
  Text: PropertyText,
  Chips: PropertyChips,
  UserStack: PropertyUserStack,
  Empty: PropertyEmpty,
  Tooltip: PropertyTooltip,

  // Behavior extractors — read from <Property.Root> context.
  Caret: PropertyCaret,
  EditTrigger: PropertyEditTrigger,
  RemoveButton: PropertyRemoveButton,
  AddButton: PropertyAddButton,

  // Editors — auto-dispatch by valueType. Use Property.Editor for "do the
  // right thing", or compose with InlineEditor / PopoverEditor when you need
  // finer control over where the editor sits in the tree.
  Editor: PropertyEditor,
  InlineEditor,
  PopoverEditor,
  EditorPopover,

  // Per-type editor leaves (rare — prefer the dispatchers above).
  InlineText: InlineTextEditor,
  InlineNumber: InlineNumberEditor,
  InlineBoolean: InlineBooleanEditor,
  InlineLink: InlineLinkEditor,

  // Composed: opinionated display + editor compositions. Drop-in replacements
  // for the legacy PropertyValue / CondensedPropertyValue routers.
  Display: PropertyDisplay,
  DisplayCondensed: PropertyDisplayCondensed,
};
