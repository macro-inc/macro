import type { EntityType } from '@service-properties/generated/schemas/entityType';

export type SelectableOption = { id: string; label: string };

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
