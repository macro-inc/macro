import { parseWorkbookMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import { CALCULATED_FUNCTIONS } from './formula-function-names';
import { storedImage } from './image-data';
import { metafilePreview } from './metafile';
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
  return withMetafilePreviews({
    sheets: workbook.sheets,
    warnings: [...new Set([...featureWarnings, ...workbook.warnings])],
    ...(workbook.images && { images: workbook.images }),
  });
}

/** Metafiles drawn for display, at most, per import. */
const MAX_METAFILE_PREVIEWS = 50;

/**
 * The workbook with pictures of its EMF and WMF images, which browsers
 * cannot show, for its drawings to display. Where there is no canvas to
 * draw them on, drawings show their names instead.
 */
async function withMetafilePreviews(
  workbook: WorkbookFileData
): Promise<WorkbookFileData> {
  const images = { ...workbook.images };
  const previews = new Map<string, string>();
  for (const [key, url] of Object.entries(images)) {
    if (previews.size >= MAX_METAFILE_PREVIEWS) break;
    const match = /^data:image\/x-(?:emf|wmf);base64,(.*)$/.exec(url);
    if (!match) continue;
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    const picture = await metafilePreview(bytes);
    const stored = picture && storedImage(picture);
    if (!stored) continue;
    images[stored.key] = stored.url;
    previews.set(key, stored.key);
  }
  if (!previews.size) return workbook;
  return {
    ...workbook,
    images,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      ...(sheet.metadata && {
        metadata: {
          ...sheet.metadata,
          ...(sheet.metadata.drawings && {
            drawings: sheet.metadata.drawings.map((drawing) =>
              drawing.type === 'image' && previews.has(drawing.image)
                ? { ...drawing, preview: previews.get(drawing.image) }
                : drawing
            ),
          }),
        },
      }),
    })),
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
