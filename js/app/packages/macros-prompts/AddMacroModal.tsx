import { useHasPaidAccess } from '@core/auth';
import { IconSelectorMenu } from '@core/component/IconSelectorMenu';
import {
  FilteredTailwindColors,
  TailwindColorPicker,
} from '@core/component/TailwindColorPicker';
import { TextButton } from '@core/component/TextButton';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import AcornIcon from '@phosphor-icons/core/regular/acorn.svg?component-solid';
import Circle from '@phosphor-icons/core/regular/circle.svg?component-solid';
import TrashIcon from '@phosphor-icons/core/regular/trash.svg?component-solid';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic, Portal } from 'solid-js/web';
// @ts-ignore
import colors from 'tailwindcss/colors';
import {
  createNewAndUpdateMacros,
  deleteMacro,
  editExistingMacro,
  type MacroPrompt,
  macroModalState,
  macroSignal,
  setInputToMacroPrompt,
  setMacroModalState,
} from './macros';

const MAX_TITLE_LENGTH = 50;

interface AddMacroModalProps {
  inputRef: Accessor<HTMLDivElement | null | undefined>;
}

export function AddMacroModal(props: AddMacroModalProps) {
  const setSelectedMacro = macroSignal.set;
  const { showPaywall } = usePaywallState();
  const hasPaidAccess = useHasPaidAccess();
  const handleOutsideClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      setErrors({});
      setMacroModalState(null);
    }
  };
  const handleKey = (e: KeyboardEvent) => {
    if (!macroModalState()) {
      return;
    }
    if (e.key === 'Escape') {
      setMacroModalState(null);
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKey);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKey);
  });
  const [createdMacroStore, setCreatedMacroStore] = createStore<MacroPrompt>({
    id: '',
    title: '',
    prompt: '',
    icon: AcornIcon,
    color: FilteredTailwindColors.blue,
  });

  const [showIconMenu, setShowIconMenu] = createSignal(false);
  const [showColorPicker, setShowColorPicker] = createSignal(false);

  const [errors, setErrors] = createSignal<{ title?: string; prompt?: string }>(
    {}
  );

  createEffect(() => {
    const mode = macroModalState();
    if (mode?.type === 'edit' && mode.macro) {
      setCreatedMacroStore(mode.macro);
    } else {
      setCreatedMacroStore({
        title: '',
        prompt: '',
        icon: AcornIcon,
        color: FilteredTailwindColors.blue,
      });
    }
  });

  async function handleSaveMacro() {
    const inputRef_ = props.inputRef() ?? null;

    const newErrors: { title?: string; prompt?: string } = {};

    if (!createdMacroStore.title.trim()) {
      newErrors.title = 'Title is required';
    }
    if (!createdMacroStore.prompt.trim()) {
      newErrors.prompt = 'Prompt is required';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      if (!hasPaidAccess()) {
        showPaywall(PaywallKey.SAVED_PROMPT);
        return;
      }

      const newMacro: MacroPrompt = { ...createdMacroStore };

      const mode = macroModalState();
      if (mode?.type === 'edit') {
        // TODO- error handling?
        await editExistingMacro(newMacro);
      } else {
        // TODO- error handling?
        await createNewAndUpdateMacros(newMacro);
      }
      setSelectedMacro(newMacro);
      setInputToMacroPrompt(inputRef_, newMacro);
      setMacroModalState(null);
    }
  }

  async function handleDeleteMacro() {
    // TODO- error handling?
    if (!createdMacroStore.id) {
      console.error('No macro id to delete');
      return;
    }
    await deleteMacro(createdMacroStore.id);
    setMacroModalState(null);
    setSelectedMacro(null);
  }

  return (
    <Portal>
      <Show when={macroModalState()!}>
        <div
          class="fixed inset-0 flex items-center justify-center shadow-3xl z-modal"
          onClick={handleOutsideClick}
        >
          <div class="bg-dialog p-6 rounded-lg shadow-lg w-2/5">
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-1">
                <label for="macro-title" class="text-sm font-medium pb-1">
                  Title
                </label>
                <input
                  type="text"
                  id="macro-title"
                  class="border border-edge rounded-md p-2 bg-input"
                  placeholder="Poetry Generator, LPA Extractor, or something..."
                  value={createdMacroStore.title}
                  maxLength={MAX_TITLE_LENGTH}
                  onInput={(e) => {
                    setCreatedMacroStore(
                      'title',
                      e.currentTarget.value.slice(0, MAX_TITLE_LENGTH)
                    );
                    setErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                />
                <Show when={errors().title}>
                  <span class="text-failure text-sm">{errors().title}</span>
                </Show>
              </div>
              <div class="flex gap-4">
                <div class="relative">
                  <TextButton
                    theme="base"
                    icon={() => (
                      <Dynamic
                        class="w-4 h-4"
                        component={createdMacroStore.icon}
                        style={{ color: colors[createdMacroStore.color][500] }}
                      />
                    )}
                    text="Icon"
                    onClick={() => setShowIconMenu(!showIconMenu())}
                  />
                  <Show when={showIconMenu()}>
                    <div class="absolute top-full left-0 z-action-menu">
                      <IconSelectorMenu
                        show={showIconMenu}
                        setShow={setShowIconMenu}
                        onIconSelect={(icon) => setCreatedMacroStore({ icon })}
                        color={createdMacroStore.color}
                        text={createdMacroStore.title}
                      />
                    </div>
                  </Show>
                </div>
                <div class="relative">
                  <TextButton
                    theme="base"
                    icon={() => (
                      <Circle
                        class="w-4 h-4"
                        style={{ color: colors[createdMacroStore.color][500] }}
                      />
                    )}
                    text="Color"
                    onClick={() => setShowColorPicker(!showColorPicker())}
                  />
                  <Show when={showColorPicker()}>
                    <div class="absolute top-full left-0">
                      <TailwindColorPicker
                        onColorSelect={(color) => {
                          setCreatedMacroStore('color', color);
                        }}
                        show={showColorPicker}
                        setShow={setShowColorPicker}
                      />
                    </div>
                  </Show>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <label for="macro-prompt" class="text-sm font-medium pb-1">
                  Prompt
                </label>
                <textarea
                  id="macro-prompt"
                  class="border border-edge rounded-md p-2 h-24 bg-input"
                  placeholder="Tell the AI what to do. Be very descriptive, like you would to a new junior colleague who is just learning how to do their job!"
                  value={createdMacroStore.prompt}
                  onInput={(e) => {
                    setCreatedMacroStore('prompt', e.currentTarget.value);
                    setErrors((prev) => ({ ...prev, prompt: undefined }));
                  }}
                />
                <Show when={errors().prompt}>
                  <span class="text-failure text-sm">{errors().prompt}</span>
                </Show>
              </div>
              <div class="flex justify-between mt-2">
                <div>
                  <Show when={macroModalState()?.type === 'edit'}>
                    <TextButton
                      theme="red"
                      icon={TrashIcon}
                      text="Delete"
                      onClick={handleDeleteMacro}
                    />
                  </Show>
                </div>
                <div class="flex gap-2">
                  <TextButton
                    theme="clear"
                    text="Cancel"
                    onClick={() => setMacroModalState(null)}
                  />
                  <TextButton
                    theme="accent"
                    text={
                      macroModalState()?.type === 'edit'
                        ? 'Save Changes'
                        : 'Save Prompt'
                    }
                    onClick={handleSaveMacro}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  );
}
