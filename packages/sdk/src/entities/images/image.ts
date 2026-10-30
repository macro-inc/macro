import type { MacroClient } from '../../utils/client';

/**
 * An image in static file storage: an upload, or one made with
 * `macro.images.generate()`. Attach it to a channel message with
 * `channel.send(text, { images: [image] })`, or pass it back to `generate` as
 * a reference.
 */
export class StaticImage {
  protected constructor(
    /** Static file id. */
    readonly id: string,
    /** Permanent URL of the image bytes. */
    readonly url: string,
    /** Intrinsic pixel width, when known; lets messages reserve space. */
    readonly width?: number,
    /** Intrinsic pixel height, when known. */
    readonly height?: number,
  ) {}

  /**
   * A handle to an image already in static file storage. Pass `width` and
   * `height` when you know them, so a message reserves the image's space
   * before it loads.
   */
  static byId(
    client: MacroClient,
    id: string,
    size?: { width: number; height: number },
  ): StaticImage {
    return new StaticImage(
      id,
      `${client.hosts['static-files']}/file/${id}`,
      size?.width,
      size?.height,
    );
  }

  /** Serialize the image reference without its client. */
  toJSON() {
    return {
      id: this.id,
      url: this.url,
      width: this.width,
      height: this.height,
    };
  }
}

/** An image made by `macro.images.generate()`, stored as a static file. */
export class GeneratedImage extends StaticImage {
  /** @internal Built from the generation response. */
  constructor(
    id: string,
    url: string,
    /** Intrinsic pixel width. */
    override readonly width: number,
    /** Intrinsic pixel height. */
    override readonly height: number,
    /** IANA media type, e.g. `image/png`. */
    readonly mimeType: string,
    /** Size of the image in bytes. */
    readonly sizeBytes: number,
    /** Commentary the model returned alongside the image, if any. */
    readonly note?: string,
  ) {
    super(id, url, width, height);
  }

  /** Serialize the generated image without its client. */
  override toJSON() {
    return {
      ...super.toJSON(),
      mimeType: this.mimeType,
      sizeBytes: this.sizeBytes,
      note: this.note,
    };
  }
}
