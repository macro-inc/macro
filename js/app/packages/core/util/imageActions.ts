import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

function extensionForImageBlob(blob: Blob): string {
  const t = (blob.type || '').toLowerCase().split(';')[0].trim();
  switch (t) {
    case 'image/svg+xml':
      return 'svg';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'image/bmp':
      return 'bmp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico';
    case 'image/tiff':
      return 'tiff';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'png';
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/png'
    )
  );
}

export async function copyImageToClipboard(
  getBlob: () => Promise<Blob | undefined>,
  fallbackUrl: string
): Promise<void> {
  try {
    const blob = await getBlob();
    if (!blob) throw new Error('No blob');

    if (isTouchDevice() && navigator.share) {
      try {
        await navigator.share({
          files: [
            new File([blob], 'image.png', {
              type: blob.type || 'image/png',
            }),
          ],
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // navigator.share failed (e.g. gesture context expired in dev) —
        // fall back to copying the URL.
        try {
          if (fallbackUrl) await navigator.clipboard.writeText(fallbackUrl);
          toast.success('Copied image URL to clipboard');
        } catch {
          toast.failure('Failed to copy image');
        }
        return;
      }
    }

    // Desktop: normalise to PNG (the only type clipboard reliably supports),
    // then write. Falls back to URL if the clipboard write fails.
    const pngBlob = blob.type === 'image/png' ? blob : await toPng(blob);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
      ]);
      toast.success('Copied to clipboard');
    } catch {
      await navigator.clipboard.writeText(fallbackUrl);
      toast.success('Copied image URL to clipboard');
    }
  } catch (err) {
    console.error('Share/clipboard operation failed:', err);
    try {
      if (fallbackUrl) await navigator.clipboard.writeText(fallbackUrl);
      toast.success('Copied image URL to clipboard');
    } catch {
      toast.failure('Failed to copy image');
    }
  }
}

export async function downloadImage(
  getBlob: () => Promise<Blob | undefined>,
  imageId: string
): Promise<void> {
  try {
    const blob = await getBlob();
    if (!blob) throw new Error('No blob');

    const filename = `image-${imageId}.${extensionForImageBlob(blob)}`;

    // iOS: Use the native share sheet instead — the user can save to Photos, AirDrop, etc.
    if (isTouchDevice() && navigator.share) {
      try {
        await navigator.share({
          files: [
            new File([blob], filename, {
              type: blob.type || 'image/png',
            }),
          ],
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    toast.success('Downloaded image');
  } catch (err) {
    console.error('Download failed:', err);
    toast.failure('Failed to download image');
  }
}
