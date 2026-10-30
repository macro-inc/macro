/** Resolve an image dragged from HTML into a file for upload. */
export async function fileFromDraggedHtml(
  html: string
): Promise<File | undefined> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const source = document.querySelector('img')?.src;
  if (!source) return undefined;
  const response = await fetch(source);
  const blob = await response.blob();
  let filename = 'image';
  try {
    const lastPart = new URL(source).pathname.split('/').at(-1);
    if (lastPart) filename = lastPart;
  } catch {}
  const extension = blob.type.split('/')[1] || 'png';
  if (!filename.includes('.')) filename = `${filename}.${extension}`;
  return new File([blob], filename, { type: blob.type });
}
