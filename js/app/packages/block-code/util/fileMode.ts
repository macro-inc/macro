const HTML_FILE_TYPES = new Set(['html', 'htm', 'xhtml', 'shtml']);

export function isHtmlFileType(fileType?: string | null) {
  if (!fileType) return false;
  return HTML_FILE_TYPES.has(fileType.toLowerCase());
}
