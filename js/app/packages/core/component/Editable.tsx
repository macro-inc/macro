import {
  type ComponentProps,
  createContext,
  createSignal,
  type JSX,
  onMount,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { type FileListSize, TEXT_SIZE_CLASSES } from './FileList/constants';

export const EditingContext = createContext<
  ReturnType<typeof createSignal<boolean>>
>(createSignal(false));
interface EditableLabelState {
  handleSubmitEdit?: (v: string) => void | Promise<void>;
  handleCancelEdit?: (e: Event) => void;
  inputClass?: string;
  labelText?: string;
  dynamicSizing?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  size?: FileListSize;
}

export type EditableLabelProps = ComponentProps<'input'> & EditableLabelState;

export function EditableLabel(props: EditableLabelProps) {
  const [editableLabelProps, inputProps] = splitProps(props, [
    'handleSubmitEdit',
    'handleCancelEdit',
    'inputClass',
    'labelText',
    'dynamicSizing',
    'placeholder',
    'allowEmpty',
  ]);
  let inputRef: undefined | HTMLInputElement;
  let spanRef: undefined | HTMLSpanElement;
  let isSubmitting = false;

  const updateInputWidth = () => {
    if (editableLabelProps.dynamicSizing && spanRef && inputRef) {
      spanRef.textContent = inputRef.value.replace(/ /g, '\u00A0');
      inputRef.style.width = `${spanRef!.offsetWidth + 4}px`;
    }
  };

  onMount(() => {
    setTimeout(() => {
      inputRef!.focus();
      inputRef!.select();
      updateInputWidth();
    }, 100);
  });

  const [_, setIsEditing] = useContext(EditingContext);

  const handleKeyPress = async (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      isSubmitting = true;
      editableLabelProps.handleCancelEdit?.(e);
      setIsEditing(false);
      inputRef!.blur();

      setTimeout(() => {
        isSubmitting = false;
      }, 100);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      const trimmedValue = inputRef!.value.trim();

      if (trimmedValue.length === 0 && !editableLabelProps.allowEmpty) {
        isSubmitting = true;
        editableLabelProps.handleCancelEdit?.(e);
        setIsEditing(false);
        inputRef!.blur();
        setTimeout(() => {
          isSubmitting = false;
        }, 100);
        return;
      }

      if (editableLabelProps.labelText === inputRef!.value) {
        isSubmitting = true;
        editableLabelProps.handleCancelEdit?.(e);
        setIsEditing(false);
        inputRef!.blur();
        setTimeout(() => {
          isSubmitting = false;
        }, 100);
        return;
      }

      isSubmitting = true;
      await editableLabelProps.handleSubmitEdit?.(inputRef!.value);
      setIsEditing(false);
      inputRef!.blur();

      setTimeout(() => {
        isSubmitting = false;
      }, 100);
    }
  };

  const handleBlur = async (e: Event) => {
    if (isSubmitting) {
      return;
    }

    const trimmedValue = inputRef!.value.trim();

    if (editableLabelProps.labelText === inputRef!.value) {
      editableLabelProps.handleCancelEdit?.(e);
      setIsEditing(false);
      return;
    }

    if (trimmedValue.length === 0 && !editableLabelProps.allowEmpty) {
      editableLabelProps.handleCancelEdit?.(e);
      setIsEditing(false);
      return;
    }

    await editableLabelProps.handleSubmitEdit?.(inputRef!.value);
    setIsEditing(false);
  };

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFocus = (e: FocusEvent) => {
    (e.target as HTMLInputElement).select();
  };

  const handleInput = (_e: InputEvent) => {
    updateInputWidth();
  };

  return (
    <>
      <input
        ref={inputRef}
        class={
          editableLabelProps.inputClass ??
          `w-full text-ink ${TEXT_SIZE_CLASSES[props.size ?? 'sm']} font-medium font-sans overflow-hidden border-0 select-all`
        }
        value={editableLabelProps.labelText}
        onBlur={handleBlur}
        onInput={handleInput}
        onFocus={handleFocus}
        onClick={handleClick}
        size={editableLabelProps.labelText?.length}
        onKeyDown={handleKeyPress}
        {...inputProps}
        placeholder={editableLabelProps.placeholder}
        autocomplete="off"
        spellcheck={false}
      />

      <Show when={editableLabelProps.dynamicSizing}>
        <span
          ref={spanRef}
          class={`text-ink text-sm font-medium font-sans 
             overflow-hidden border-0 min-w-12 max-w-42
             absolute whitespace-pre invisible`}
          style="top: 0; left: 0;"
        ></span>
      </Show>
    </>
  );
}

export type EditableComponentProps = {
  editingComponent: JSX.Element;
  isEditing?: boolean;
} & (
  | { component: JSX.Element; children?: never }
  | { component?: never; children: JSX.Element }
);

export function EditableProvider(props: EditableComponentProps) {
  const [isEditing, setIsEditing] = createSignal(props.isEditing ?? false);
  return (
    <EditingContext.Provider value={[isEditing, setIsEditing]}>
      <Show when={!isEditing()} fallback={props.editingComponent}>
        {props.children ?? props.component}
      </Show>
    </EditingContext.Provider>
  );
}
