import type {
  DocxExpandedPart,
  DocxExpandedPartWithoutSha,
} from '@service-storage/util/getDocxFile';

export async function zipDocxExpandedParts(
  parts: Array<DocxExpandedPart | DocxExpandedPartWithoutSha>
): Promise<Blob> {
  const { default: JsZip } = await import('jszip');
  const zip = new JsZip();

  parts.forEach(({ path, content }) => {
    zip.file(path, content as ArrayBuffer);
  });

  return zip.generateAsync({ type: 'blob' });
}

export function processRTF(rtfData: string): string {
  return removeUnnecessaryMetadata(rtfData);
}

function removeUnnecessaryMetadata(rtfContent: string): string {
  // Split the RTF content into sections
  const sections = rtfContent.split(/(?=\{\\)/);

  const processedSections = sections.filter((section) => {
    // Keep the RTF header
    if (section.startsWith('{\\rtf1')) {
      return true;
    }
    // Keep revision table
    if (section.includes('{\\*\\revtbl')) {
      return true;
    }
    // Remove font table
    if (section.includes('{\\fonttbl')) {
      return false;
    }
    // Remove color table
    if (section.includes('{\\colortbl')) {
      return false;
    }
    // Remove only stylesheet definition tables, not styled text
    if (section.match(/^\{\\stylesheet/)) {
      return false;
    }
    // Remove generator info
    if (section.includes('{\\*\\generator')) {
      return false;
    }
    // Keep headers and footers
    if (section.includes('\\header') || section.includes('\\footer')) {
      return true;
    }
    // Keep body text and revisions
    if (
      section.includes('\\loch') ||
      section.includes('\\revised') ||
      section.includes('\\deleted')
    ) {
      return true;
    }
    // Remove other metadata
    if (section.match(/\{\\[\w*]+/)) {
      return false;
    }
    // Keep other sections by default
    return true;
  });

  // Join the processed sections back into a single string
  return processedSections.join('');
}
