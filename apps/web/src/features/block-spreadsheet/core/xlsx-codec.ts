import { parseWorkbookMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import { CALCULATED_FUNCTIONS } from './formula-function-names';
import {
  type WorkbookFileData,
  type WorkbookFileExport,
  XLSX_MAX_BYTES,
} from './workbook-file-types';
import {
  inspectXlsxArchive,
  openXlsxArchive,
  xlsxFeatureWarnings,
} from './xlsx-archive';
import { readXlsxWorkbook } from './xlsx-reader';
import { writeXlsxWorkbook } from './xlsx-writer';

/** Parse entirely off-document; nothing is persisted until the caller confirms. */
export async function decodeXlsx(bytes: Uint8Array): Promise<WorkbookFileData> {
  const archive = openXlsxArchive(bytes);
  const featureWarnings = xlsxFeatureWarnings(archive.names);
  const workbook = readXlsxWorkbook(archive, {
    supportedFunctions: CALCULATED_FUNCTIONS,
  });
  for (const sheet of workbook.sheets)
    if (
      sheet.metadata &&
      !parseWorkbookMetadata(JSON.stringify(sheet.metadata))
    )
      throw new Error('Unsupported Excel layout or name definitions.');
  return {
    sheets: workbook.sheets,
    warnings: [...new Set([...featureWarnings, ...workbook.warnings])],
    ...(workbook.images && { images: workbook.images }),
  };
}

export async function encodeXlsx(
  input: Pick<WorkbookFileData, 'sheets' | 'images'>
): Promise<WorkbookFileExport> {
  const result = writeXlsxWorkbook(input);
  if (result.bytes.length > XLSX_MAX_BYTES)
    throw new Error(
      `The exported workbook exceeds the ${XLSX_MAX_BYTES / 1024 / 1024} MB file limit. Export a smaller workbook.`
    );
  // Ensure our exports obey the same archive bounds as files we can reopen.
  inspectXlsxArchive(result.bytes);
  return result;
}
