import { blockAcceptedFileExtensionToMimeType } from "@core/constant/allBlocks";

type OldSupportedExt = 'pdf' | 'docx';

const oldSupportedFiles = {
  pdf: "PDF",
  docx: "Microsoft Word",
} as const;

export type FileTypeName = (typeof oldSupportedFiles)[OldSupportedExt];


export interface FileFilter {
  ext: OldSupportedExt;
  // com
  name: FileTypeName;
  mime: string;
}

export function filterFromExt(ext: OldSupportedExt): FileFilter {
  const filter = {
    name: oldSupportedFiles[ext],
    ext,
    mime: blockAcceptedFileExtensionToMimeType[ext],
  };
  return filter;
}

/*
 * Helper which merges all common file names into comma separated string
 */
function _collectCommonName(filters: Array<FileFilter>): string {
  const names = filters.map((f) => f.name);
  const unique = [...new Set(names)];
  return unique.join(', ');
}


export function browserFileFilter({
  filters,
  collect = true,
}: {
  filters: Array<FileFilter>;
  collect?: boolean;
}) {
  if (collect) {
    const entries = filters.map((f) => [f.mime, [`.${f.ext}`]]);
    return {
      excludeAcceptAllOption: true,
      types: [
        {
          description: _collectCommonName(filters),
          accept: Object.fromEntries(entries),
        },
      ],
    };
  }
  return {
    excludeAcceptAllOption: true,
    types: filters.map((f) => ({
      description: f.name,
      accept: { [f.mime]: [`.${f.ext}`] },
    })),
  };
}
