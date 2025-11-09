// import type { Item } from '@service-storage/generated/schemas/item';

// import type { FileType } from '@core/block';
// import type { BLOCK_ICON_SIZE_CLASSES } from '@core/component/BlockTypeIcon';
// import { TruncatedText } from '@core/component/FileList/TruncatedText';
// import { formatName } from '@core/component/FileList/util';
// import FolderIcon from '@icon/fill/folder-fill.svg?component-solid';
// import type { ItemType } from '@service-storage/client';
// import { type Accessor, Match, type Setter, Switch } from 'solid-js';

// type GridViewProps<T extends ItemType> = {
//   itemType: T;
// } & (T extends 'document'
//   ? {
//       fileType?: FileType;
//     }
//   : {
//       fileType?: undefined;
//     }) & {
//     id: string;
//     name: string;
//     owner: string;
//     updatedAt: number;
//     createdAt: number;
//     parentId?: string;
//     pinned: boolean;
//     pinIndex?: number;
//     size: keyof typeof BLOCK_ICON_SIZE_CLASSES;
//     // selectableTypes?: ItemType[];
//     // setSelectedItems: Setter<Item[]>;
//     // selectedItems: Accessor<Item[]>;
//   };

// export function GridView<T extends ItemType>(props: GridViewProps<T>) {
//   // const blockName = createMemo(() => {
//   //   return fileTypeToBlockName(props.fileType ?? props.itemType);
//   // });
//   // const href = () => propsToHref({ fileType: blockName(), id: props.id });

//   const formattedName = formatName(props.fileType, props.name);

//   // const [accessLevel] = createResource(
//   //   () => [props.itemType, props.id] as const,
//   //   async ([itemType, id]) => getItemAccessLevel(itemType, id)
//   // );

//   return (
//     <Switch>
//       <Match when={props.itemType === 'project'}>
//         <div class="flex flex-row gap-2">
//           <FolderIcon />
//           <TruncatedText size={props.size}>{formattedName}</TruncatedText>
//         </div>
//       </Match>
//       <Match when={props.itemType !== 'project'}>
//         <div>
//           <h2>{props.name}</h2>
//         </div>
//       </Match>
//     </Switch>
//   );
// }
