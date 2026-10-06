import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { uploadFile } from '@core/util/upload';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import type { CanvasAssetSource, PreparedMedia } from '../core/assets';

async function dimensions(url: string, type: 'image' | 'video') {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const element =
      type === 'image' ? new Image() : document.createElement('video');
    const dispose = () => {
      clearTimeout(timeout);
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLVideoElement) {
        element.onloadedmetadata = null;
        element.removeAttribute('src');
        element.load();
      }
    };
    const done = () => {
      const width =
        element instanceof HTMLImageElement
          ? element.naturalWidth
          : element.videoWidth;
      const height =
        element instanceof HTMLImageElement
          ? element.naturalHeight
          : element.videoHeight;
      dispose();
      if (!width || !height) {
        reject(new Error('Media has no dimensions'));
        return;
      }
      const scale = Math.min(1, 640 / width, 480 / height);
      resolve({ width: width * scale, height: height * scale });
    };
    const fail = () => {
      dispose();
      reject(new Error('Could not load media'));
    };
    const timeout = setTimeout(fail, 20000);
    element.onerror = fail;
    if (element instanceof HTMLVideoElement) {
      element.preload = 'metadata';
      element.onloadedmetadata = done;
    } else element.onload = done;
    element.src = url;
  });
}
export const canvasAssetSource: CanvasAssetSource = {
  async upload(file) {
    const type = fileTypeToBlockName(file.name.split('.').pop());
    const kind =
      file.type.startsWith('video/') || type === 'video'
        ? 'video'
        : file.type.startsWith('image/') || type === 'image'
          ? 'image'
          : undefined;
    if (!kind) throw new Error('Choose an image or video');
    // The shared uploader handles validation and HEIC conversion.
    const result = await uploadFile(file, 'static', {
      hideProgressIndicator: true,
    });
    if (result.failed) throw result.error;
    const size = await dimensions(staticFileIdEndpoint(result.id), kind);
    return {
      type: kind,
      geometry: {
        ...size,
        source: { type: 'static', id: result.id },
        name: file.name,
      },
    };
  },
  async media(asset): Promise<PreparedMedia> {
    const type = fileTypeToBlockName(asset.fileType);
    if (type !== 'image' && type !== 'video')
      throw new Error('Not an image or video');
    const result = await fetchBinaryDocumentData(asset.id);
    if (result.isErr()) throw new Error('Unable to load this media file');
    const size = await dimensions(result.value.blobUrl, type);
    return {
      type,
      geometry: {
        ...size,
        source: { type: 'document', id: asset.id },
        name: asset.name,
      },
    };
  },
};
