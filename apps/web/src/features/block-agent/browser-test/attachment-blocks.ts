// Only file-icon classification is needed by the image attachment fixture.
export const blockAcceptedFileExtensionSet = new Set(['png', 'jpg']);
export const fileTypeToBlockName = () => 'image' as const;
export const isBlockAlias = () => false;
export const itemToBlockName = () => 'image' as const;
