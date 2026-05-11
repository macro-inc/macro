import PencilSimpleLine from '@icon/regular/pencil-simple-line.svg';
import { cn } from '@ui';
import { createSignal, Show, useContext } from 'solid-js';
import { EditableLabel, EditingContext } from './Editable';

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
  const [, setIsRenaming] = useContext(EditingContext);

  const handleSave = (newValue: string) => {
    setIsRenaming(false);
    if (props.onSave) {
      props.onSave(newValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsRenaming(false);
    setInputValue(props.value || '');
    setIsEditing(false);
  };

  return (
    <div class={cn(props.class)}>
      {props.label && <div class="text-sm text-ink mb-1">{props.label}</div>}

      <Show
        when={isEditing()}
        fallback={
          <div class="group flex items-center">
            <button
              type="button"
              class="mr-2 text-xs text-accent-ink/80 hover:text-accent-ink hover-transition-text opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
              onClick={() => setIsEditing(true)}
              aria-label={`Edit ${props.label || 'field'}`}
            >
              <PencilSimpleLine class="size-4" />
            </button>
            <span class="text-ink-placeholder text-xs/5">
              {props.value || props.placeholder || 'Click to edit'}
            </span>
          </div>
        }
      >
        <div class="space-y-2 inline-block">
          <div class="flex flex-row h-8 justify-start items-center cursor-default border shadow-inner border-edge bg-input text-ink">
            <div class="flex flex-row h-full px-2 justify-center items-center gap-2 font-medium text-sm/5 whitespace-nowrap">
              <EditableLabel
                handleSubmitEdit={handleSave}
                handleCancelEdit={handleCancel}
                labelText={props.value || inputValue() || ''}
                type="text"
                dynamicSizing
                data-1p-ignore
                placeholder={props.placeholder}
                allowEmpty={props.allowEmpty}
              />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default EditableField;
