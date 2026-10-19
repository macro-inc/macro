import { fireAndForget } from '@core/util/fireAndForget';
import { tableBounds } from '@macro-inc/spreadsheet/sheet-tables';
import type { TableGridUi } from '../components/SpreadsheetGrid';
import {
  TableColumnMenu,
  type TableColumnStructure,
} from '../components/TableColumnMenu';
import { TableDialog } from '../components/TableDialog';
import { TableGroupByDialog } from '../components/TableGroupByDialog';
import { TableMenu } from '../components/TableMenu';
import type { TableActions } from '../primitives/create-table-actions';

/**
 * The grid's table menus, bound to the table actions. Dialogs they open wait
 * for `afterMenu`, once the menu has closed and returned focus.
 */
export function tableGridUi(options: {
  actions: TableActions;
  editable: () => boolean;
  canChangeStructure: () => boolean;
  changeColumns: (column: number, action: TableColumnStructure) => void;
  restoreFocus: () => void;
  afterMenu: (open: () => void) => void;
}): TableGridUi {
  const { actions } = options;
  return {
    columnMenu: (table, column) => {
      const name = () => table().name;
      return (
        <TableColumnMenu
          column={
            actions.columnNames(name())[column - tableBounds(table()).left] ??
            ''
          }
          type={actions.columnType(name(), column)}
          filter={actions.columnFilter(name(), column)}
          choices={() => actions.columnChoices(name(), column)}
          canChangeStructure={options.canChangeStructure()}
          onSort={(descending) => {
            fireAndForget(
              actions.sortColumn(name(), column, descending),
              'spreadsheet-editor'
            );
          }}
          onFilter={(filter) => actions.filterColumn(name(), column, filter)}
          onType={(type) => actions.setColumnType(name(), column, type)}
          onGroupBy={() =>
            options.afterMenu(() => actions.openGroupBy(name(), column))
          }
          onStructure={(action) => options.changeColumns(column, action)}
          onRestoreFocus={options.restoreFocus}
        />
      );
    },
    tableMenu: (table, style, inHeader) => {
      const name = () => table().name;
      return (
        <TableMenu
          table={table()}
          readonly={!options.editable()}
          open={actions.menuOpen() === name()}
          onOpenChange={(open) =>
            actions.setMenuOpen(open ? name() : undefined)
          }
          style={style()}
          compact={inHeader()}
          onRename={() => options.afterMenu(() => actions.openRename(name()))}
          onAdjustRange={() =>
            options.afterMenu(() => actions.openRange(name()))
          }
          onColor={(color) => actions.setColor(name(), color)}
          onOption={(option, on) => actions.setOption(name(), option, on)}
          onTotalsRow={(on) => actions.setTotalsRow(name(), on)}
          onGroupBy={() => options.afterMenu(() => actions.openGroupBy(name()))}
          onClearFilters={() => actions.clearFilters(name())}
          onConvertToRange={() => actions.convertToRange(name())}
          onDelete={() => actions.deleteTable(name())}
          onRestoreFocus={options.restoreFocus}
        />
      );
    },
    mismatch: actions.mismatch,
    totalLabel: actions.totalLabel,
    columnNames: actions.columnNames,
    menuTable: actions.menuOpen,
  };
}

/** The table rename, range and group by dialogs. */
export function SpreadsheetTableDialogs(props: {
  actions: TableActions;
  readonly: boolean;
  onRestoreFocus: () => void;
}) {
  const table = () => {
    const view = props.actions.groupView();
    return view && props.actions.table(view.table);
  };
  const left = () => {
    const current = table();
    return current ? tableBounds(current).left : 0;
  };
  return (
    <>
      <TableDialog
        dialog={props.actions.dialog()}
        error={props.actions.error()}
        onSave={props.actions.save}
        onClose={props.actions.closeDialog}
        onRestoreFocus={props.onRestoreFocus}
      />
      <TableGroupByDialog
        view={table() && props.actions.groupView()}
        columns={props.actions.columnNames(table()?.name ?? '')}
        left={left()}
        groups={props.actions.groups()}
        readonly={props.readonly}
        format={props.actions.formatSummary}
        onChange={props.actions.setGroupView}
        onShowGroup={props.actions.showGroup}
        onClose={props.actions.closeGroupBy}
        onRestoreFocus={props.onRestoreFocus}
      />
    </>
  );
}
