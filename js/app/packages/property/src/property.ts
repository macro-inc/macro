// Composable property component namespace.
//
// Mirrors @entity: small extractors compose under <Property.Root> to render
// property values in any layout, replacing the duplicated PropertyValue /
// CondensedPropertyValue / InlinePropertyValue / ListPropertyValue trees.

import { Layout } from './core/Layout';
import { Root } from './core/Root';
import { Slot } from './core/Slot';
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
};
