import { Show } from 'solid-js';
import { AddColumnButton } from '../components/add-column-button';
import { useDatabase } from '../context/database';
import { FormulaEditingContext } from '../context/formula-editing';
import {
  OptionEditingContext,
  useOptionEditing,
} from '../context/option-editing';
import {
  DatabaseRecordsView,
  type DatabaseRecordsViewProps,
} from './database-records-view';

type HostProps = Omit<
  DatabaseRecordsViewProps,
  | 'name'
  | 'source'
  | 'canEdit'
  | 'onChangeColumnType'
  | 'onDeleteColumn'
  | 'onReorderColumns'
  | 'onRenameColumn'
  | 'createColumn'
  | 'addColumn'
>;

/** The complete records editor, wired once to the surrounding database controller. */
export function DatabaseRecords(props: HostProps) {
  const database = useDatabase();
  const hostOptions = useOptionEditing();
  return (
    <OptionEditingContext.Provider
      value={hostOptions ?? database.optionEditing()}
    >
      <FormulaEditingContext.Provider value={database.formulaEditing()}>
        <DatabaseRecordsView
          {...props}
          name={database.data.table()?.name ?? ''}
          source={database.data.rows}
          canEdit={database.capabilities().editRows}
          onChangeColumnType={database.schemaEditing()?.changeType}
          onDeleteColumn={database.schemaEditing()?.remove}
          onReorderColumns={database.schemaEditing()?.reorder}
          onRenameColumn={database.schemaEditing()?.rename}
          createColumn={database.schemaEditing()?.createDefaultColumn}
          addColumn={
            database.schemaEditing()
              ? (label, onCreated) => (
                  <Show when={database.schemaEditing()}>
                    {(schema) => (
                      <AddColumnButton
                        create={schema().createDefaultColumn}
                        label={label}
                        onCreated={onCreated}
                      />
                    )}
                  </Show>
                )
              : undefined
          }
        />
      </FormulaEditingContext.Provider>
    </OptionEditingContext.Provider>
  );
}
