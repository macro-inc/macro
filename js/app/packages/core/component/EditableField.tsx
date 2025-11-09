import PencilSimpleLine from '@icon/regular/pencil-simple-line.svg';
import { createSignal, Show } from 'solid-js';
import { EditingTextButton } from './TextButton';

export interface EditableFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  class?: string;
  onSave?: (value: string) => void;
  allowEmpty?: boolean;
}

const EditableField = (props: EditableFieldProps) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [inputValue, setInputValue] = createSignal(props.value || '');

  const handleSave = (newValue: string) => {
    if (props.onSave) {
      props.onSave(newValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setInputValue(props.value || '');
    setIsEditing(false);
  };

  return (
    <div class={`mb-4 ${props.class || ''}`}>
      {props.label && <div class="text-sm text-ink mb-1">{props.label}</div>}

      <Show
        when={isEditing()}
        fallback={
          <div class="group flex items-center">
            <span class="text-ink-placeholder text-xs leading-5">
              {props.value || props.placeholder || 'Click to edit'}
            </span>
            <button
              type="button"
              class="ml-2 text-xs text-accent-ink/80 hover:text-accent-ink hover-transition-text opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
              onClick={() => setIsEditing(true)}
              aria-label={`Edit ${props.label || 'field'}`}
            >
              <PencilSimpleLine class="w-4 h-4" />
            </button>
          </div>
        }
      >
        <div class="space-y-2 inline-block">
          <EditingTextButton
            handleSubmitEdit={handleSave}
            handleCancelEdit={handleCancel}
            labelText={props.value || inputValue() || ''}
            theme="clear"
            type="text"
            dynamicSizing
            data-1p-ignore
            placeholder={props.placeholder}
            allowEmpty={props.allowEmpty}
          />
        </div>
      </Show>
    </div>
  );
};

export default EditableField;
