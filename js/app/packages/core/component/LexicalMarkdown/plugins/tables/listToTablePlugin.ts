import { ListNode } from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import type { SetStoreFunction } from 'solid-js/store';
import { ListToTableAccessory } from '../../component/accessory/ListToTableAccessory';
import {
  type AccessoryStore,
  nodeAccessoryPlugin,
} from '../node-accessory/nodeAccessoryPlugin';
import { registerListToTableCommand } from './listToTable';

type ListToTablePluginProps = {
  accessories: AccessoryStore;
  setAccessories: SetStoreFunction<AccessoryStore>;
};

/**
 * List → table conversion: registers LIST_TO_TABLE_COMMAND and a hover
 * accessory on table-shaped lists that dispatches it. Requires a
 * <NodeAccessoryRenderer /> bound to the same store.
 */
export function listToTablePlugin(props: ListToTablePluginProps) {
  return (editor: LexicalEditor) =>
    mergeRegister(
      registerListToTableCommand(editor),
      nodeAccessoryPlugin({
        klass: ListNode,
        store: props.accessories,
        setStore: props.setAccessories,
        component: ({ ref, key }) =>
          ListToTableAccessory({ floatRef: ref, editor, nodeKey: key }),
      })(editor)
    );
}
