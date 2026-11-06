import type {
  GenerateImageAspectRatio,
  GenerateImageReference,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { GeneratedImage, type StaticImage } from './image';

export type { GenerateImageAspectRatio };

/** What image to generate. */
export interface GenerateImageOptions {
  /**
   * Description of the image: subject, style (photo, illustration, flat
   * vector...), composition, colours, mood, and any text that must appear.
   */
  prompt: string;
  /**
   * Shape of the image: `square` (1:1, the default), `landscape` (4:3),
   * `portrait` (3:4), `widescreen` (16:9, banners and slides) or `tall`
   * (9:16, phone screens and stories).
   */
  aspectRatio?: GenerateImageAspectRatio;
  /**
   * Up to three images to edit or draw from, in the order the prompt refers
   * to them ("image 1", "image 2"): image documents the caller can view, or
   * static images such as an earlier generation or an attachment.
   */
  referenceImages?: (Document | StaticImage)[];
}

/** Image generation, charged to the acting user's AI allowance. */
export class ImagesNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Generate or edit an image with Google's Nano Banana model and store it as
   * a static file. Takes several seconds. Post it with
   * `channel.send(text, { images: [image] })`; the returned width and height
   * let the message reserve space before the image loads.
   *
   * @example
   * const image = await macro.images.generate({
   *   prompt: 'A watercolor lighthouse at dusk',
   *   aspectRatio: 'widescreen',
   * });
   * await channel.send('Fresh off the press', { images: [image] });
   */
  async generate(options: GenerateImageOptions): Promise<GeneratedImage> {
    const image = unwrap(
      await this.client.cognition.generateImage({
        body: {
          prompt: options.prompt,
          aspectRatio: options.aspectRatio ?? null,
          referenceImages: (options.referenceImages ?? []).map(toReference),
        },
      }),
    );
    return new GeneratedImage(
      image.staticFileId,
      image.url,
      image.width,
      image.height,
      image.mimeType,
      image.sizeBytes,
      image.note ?? undefined,
    );
  }
}

function toReference(image: Document | StaticImage): GenerateImageReference {
  return image instanceof Document
    ? { type: 'document', id: image.id }
    : { type: 'staticFile', id: image.id };
}
