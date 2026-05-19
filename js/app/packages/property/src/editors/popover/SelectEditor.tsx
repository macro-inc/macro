import { usePropertyEditor } from '@core/component/Properties/hooks/usePropertyEditor';
import {
  useAddPropertyOptionMutation,
  usePropertyOptionsQuery,
} from '@queries/properties/options';
import { onMount, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { PropertyApiValues, SelectProperty } from '../../types';
import { formatOptionValue, isSelectProperty } from '../../utils';
import { PropertyOptionSelector } from '../selectors/PropertyOptionSelector';
import { EditorPopover } from './EditorPopover';

/**
 * Popover dropdown for SELECT_STRING / SELECT_NUMBER. Loads options via
 * usePropertyOptionsQuery, tracks local selection, saves accumulated state
 * on close (matches existing modal UX — single-select closes-on-pick,
 * multi-select stays open until Done/click-out/ESC).
 */
export function SelectEditor() {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen() && isSelectProperty(ctx.property())}>
      <SelectEditorBody />
    </Show>
  );
}

function SelectEditorBody() {
  const ctx = useProperty();
  const property = ctx.property() as SelectProperty;

  const optionsQuery = usePropertyOptionsQuery(
    () => property.propertyDefinitionId
  );
  const addOptionMutation = useAddPropertyOptionMutation({});

  const options = () =>
    optionsQuery.isLoading || optionsQuery.isError || !optionsQuery.data
      ? []
      : optionsQuery.data;

  const isLoading = () => optionsQuery.isLoading || addOptionMutation.isPending;

  const editor = usePropertyEditor(
    property,
    options,
    addOptionMutation.mutateAsync
  );

  onMount(() => {
    editor.initializeSelectedOptions();
    optionsQuery.refetch();
  });

  const closeAndSave = async () => {
    if (editor.hasChanges()) {
      const arr = Array.from(editor.selectedOptions());
      const apiValues: PropertyApiValues =
        property.valueType === 'SELECT_NUMBER'
          ? {
              valueType: 'SELECT_NUMBER',
              values: arr.length > 0 ? arr : null,
            }
          : {
              valueType: 'SELECT_STRING',
              values: arr.length > 0 ? arr : null,
            };
      try {
        await ctx.onSave?.(property, apiValues);
        ctx.onRefresh?.();
      } catch {
        // mutation onError owns toast
      }
    }
    ctx.closeEditor();
  };

  const canAddOption = (query: string) => {
    if (property.isSystemProperty) return false;
    if (property.valueType === 'SELECT_STRING') return true;
    if (property.valueType === 'SELECT_NUMBER') {
      const n = parseFloat(query);
      return !Number.isNaN(n) && Number.isFinite(n);
    }
    return false;
  };

  return (
    <EditorPopover onClose={closeAndSave}>
      <Show when={!isLoading()}>
        <PropertyOptionSelector
          config={{
            isMultiSelect: property.isMultiSelect,
            placeholder: `${property.isMultiSelect ? 'Add' : 'Change'} ${property.displayName.toLowerCase()}...`,
            inputType:
              property.valueType === 'SELECT_NUMBER' ? 'number' : 'text',
            canAddOption: property.isSystemProperty ? undefined : canAddOption,
          }}
          options={options().map((opt) => ({
            id: opt.id,
            label: formatOptionValue(opt),
          }))}
          isLoading={false}
          error={null}
          selectedOptions={editor.selectedOptions}
          onToggleOption={editor.toggleOption}
          onAddOption={property.isSystemProperty ? undefined : editor.addOption}
          clearOption={
            !property.isMultiSelect && !property.isRequired
              ? {
                  label: `No ${property.displayName.toLowerCase()}`,
                  onClear: editor.clearOptions,
                }
              : undefined
          }
          onClose={closeAndSave}
        />
      </Show>
    </EditorPopover>
  );
}
