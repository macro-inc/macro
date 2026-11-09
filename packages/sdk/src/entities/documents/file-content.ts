/** A file's content: its bytes, or text stored as UTF-8. */
export type FileContent = Uint8Array<ArrayBuffer> | ArrayBuffer | Blob | string;

/** The content as one blob, as storage's upload routes take it. */
export function toBlob(content: FileContent): Blob {
  return content instanceof Blob ? content : new Blob([content]);
}
