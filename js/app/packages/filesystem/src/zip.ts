import { DocxExpandedPart, DocxExpandedPartWithoutSha } from '@service-storage/util/getDocxFile';

export async function zipDocxExpandedParts(
  parts: Array<DocxExpandedPart | DocxExpandedPartWithoutSha>
) {
  const { default: JsZip } = await import('jszip');
  const zip = new JsZip();

  parts.forEach(({ path, content }) => {
    zip.file(path, content);
  });

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
