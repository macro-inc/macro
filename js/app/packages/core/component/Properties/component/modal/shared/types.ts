import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { JSX } from 'solid-js';

export type SelectableOption = { id: string; label: string };

export type PinnedOption = { id: string; label: string; icon?: JSX.Element };

export type OptionSelectorConfig = {
  isMultiSelect: boolean;
  placeholder: string;
  inputType?: 'text' | 'number';
  canAddOption?: (query: string) => boolean;
};

export type EntitySelectorConfig = {
  isMultiSelect: boolean;
  placeholder: string;
  specificEntityType?: EntityType | null;
  selfFilter?: { entityType: EntityType; blockId?: string };
};
