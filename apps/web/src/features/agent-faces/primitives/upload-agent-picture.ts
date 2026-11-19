import { staticFileIdEndpoint } from '@core/constant/servers';
import { uploadFile } from '@core/util/upload';
import { type AgentFace, renderFace } from '@macro-inc/agent-faces';
import { Telemetry } from '@macro-inc/observability';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import type { FaceDraft } from './create-face-draft';

/**
 * An agent's picture as the server stores it: a face with the PNG drawn from
 * it (`url` null when that PNG could not be saved, so clients draw the face),
 * or a photo with no face.
 */
export type AgentPicture =
  | { face: AgentFace; url: string | null }
  | { face: null; url: string };

/** Edge, in px, of the PNG saved beside a face, for clients that can't draw one. */
const FACE_PNG_SIZE = 256;

export type PictureUploadError = { kind: 'photo_upload_failed' };

/**
 * Saves what `draft` holds. A face always succeeds: its PNG is a convenience,
 * and a failure only leaves `url` null. A photo that fails to upload fails.
 */
export async function uploadAgentPicture(
  draft: Pick<FaceDraft, 'face' | 'photo'>
): Promise<Result<AgentPicture, PictureUploadError>> {
  const photo = draft.photo();
  if (photo) {
    const url = await uploadStatic(photo.file);
    if (url.isErr()) return err({ kind: 'photo_upload_failed' });
    return ok({ face: null, url: url.value });
  }

  const face = draft.face();
  const png = await ResultAsync.fromPromise(facePng(face), (error) => error);
  if (png.isErr()) {
    Telemetry.error(png.error, { surface: 'agent-face.png' });
    return ok({ face, url: null });
  }
  const url = await uploadStatic(png.value);
  return ok({ face, url: url.isOk() ? url.value : null });
}

async function uploadStatic(file: File): Promise<Result<string, unknown>> {
  const result = await ResultAsync.fromPromise(
    uploadFile(file, 'static'),
    (error) => error
  );
  if (result.isErr()) {
    Telemetry.error(result.error, { surface: 'agent-face.upload' });
    return err(result.error);
  }
  if (result.value.failed || result.value.destination !== 'static')
    return err(result.value);
  return ok(staticFileIdEndpoint(result.value.id));
}

/** Draws `face` onto a canvas and returns it as a PNG file. */
async function facePng(face: AgentFace): Promise<File> {
  const svg = renderFace(face, { size: FACE_PNG_SIZE });
  const image = new Image(FACE_PNG_SIZE, FACE_PNG_SIZE);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = FACE_PNG_SIZE;
  canvas.height = FACE_PNG_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2d canvas context');
  context.drawImage(image, 0, 0, FACE_PNG_SIZE, FACE_PNG_SIZE);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Canvas produced no PNG');
  return new File([blob], 'agent-face.png', { type: 'image/png' });
}
