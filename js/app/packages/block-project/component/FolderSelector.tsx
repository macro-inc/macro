// import type { Item } from "@service-storage/generated/schemas/item";
// import { createSignal } from "solid-js";
// import { ProjectFileExplorer } from "./ProjectFileExplorer";

// export function FolderSelector() {
//   // const [selectedFolders, setSelectedFolders] = createSignal<Item[]>([]);

//   // TODO: Implement this correctly
//   // const handleSetSelectedFolders = (item: Item) => {
//   //   // Only allow selecting one project folder at a time
//   //   if (selectedFolders().length > 0) {
//   //     const lastSelectedItem = selectedFolders()[selectedFolders().length - 1];
//   //     if (lastSelectedItem.type === 'project') {
//   //       setSelectedFolders([lastSelectedItem]);
//   //     } else {
//   //       setSelectedFolders([]);
//   //     }
//   //   } else {
//   //     setSelectedFolders([]);
//   //   }
//   // };

//   return (
//     <ProjectFileExplorer
//       size="md"
//       viewType={'treeList'}
//       selectedItems={selectedFolders}
//       handleSetSelectedItem={handleSetSelectedFolders}
//       selectableTypes={['project']}
//     />
//   );
// }
