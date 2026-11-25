import { t } from '@app/lib/i18n';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import type { Accessor } from 'solid-js';
import { createComposerGuestSelection } from '../../../primitives/create-composer-guest-selection';
import type {
  EventEditorGuestOption,
  SelectedEventEditorGuest,
} from '../event-form-model';

export interface ComposerGuestPickerProps {
  options: Accessor<EventEditorGuestOption[]>;
  selected: SelectedEventEditorGuest[];
  excluded?: SelectedEventEditorGuest[];
  onChange: (selected: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
  fillHeight?: boolean;
}

export function ComposerGuestPicker(props: ComposerGuestPickerProps) {
  const selection = createComposerGuestSelection({
    options: props.options,
    selected: () => props.selected,
    excluded: () => props.excluded ?? [],
    onChange: (selected) => props.onChange(selected),
  });
  return (
    <PropertyEntitySelector
      config={{
        isMultiSelect: true,
        placeholder: t('calendar.addGuests'),
        specificEntityType: 'USER',
        additionalUsers: selection.users,
        excludedIds: selection.excludedIds,
        allowCustomEmail: true,
        fillHeight: props.fillHeight,
      }}
      selectedOptions={selection.selectedIds}
      onUserSelected={selection.pick}
      setSelectedOptions={selection.commit}
      onClose={props.onClose}
    />
  );
}
