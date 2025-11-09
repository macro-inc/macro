import type { FileType } from '@service-storage/generated/schemas/fileType';

export type FileItem = {
  name: string;
  id: string;
  type?: FileType;
};
