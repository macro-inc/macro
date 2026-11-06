import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { StaticImage } from '../images/image';

/** How to store an uploaded profile picture. */
export interface UploadProfilePictureOptions {
  /** File name, such as `avatar.png`. */
  fileName: string;
  /** `image/png`, `image/jpeg`, `image/webp` or `image/gif`. */
  contentType: string;
}

/** What to change on the authenticated user's profile. */
export interface UpdateMeOptions {
  /** Display name. The first word becomes the first name. */
  name?: string;
  /** An image from {@link MeNamespace.uploadProfilePicture}. */
  profilePicture?: StaticImage;
}

/** The authenticated user's own profile. */
export class MeNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Upload an image to use as your profile picture. This only stores it; pass
   * the result to {@link MeNamespace.update} to start using it. Pictures can be
   * at most 16 MB, and each user can start 20 uploads an hour.
   */
  async uploadProfilePicture(
    data: Blob | Uint8Array<ArrayBuffer>,
    options: UploadProfilePictureOptions,
  ): Promise<StaticImage> {
    const { file_id, upload_url } = unwrap(
      await this.client.auth.createProfilePictureUpload({
        body: {
          file_name: options.fileName,
          content_type: options.contentType,
          size_bytes: data instanceof Blob ? data.size : data.byteLength,
        },
      }),
    );
    const response = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      body: data,
    });
    if (!response.ok) {
      throw new MacroError(`image upload failed with ${response.status}`);
    }
    return StaticImage.byId(this.client, file_id);
  }

  /**
   * Set your display name and profile picture. Agents should do this after
   * signing in, so teammates can tell who they are working with.
   *
   * @example
   * const image = await macro.me.uploadProfilePicture(bytes, {
   *   fileName: 'avatar.png',
   *   contentType: 'image/png',
   * });
   * await macro.me.update({ name: 'Research Agent', profilePicture: image });
   */
  async update(options: UpdateMeOptions): Promise<void> {
    if (options.profilePicture) {
      unwrap(
        await this.client.auth.putProfilePictureFile({
          body: { file_id: options.profilePicture.id },
        }),
      );
    }

    const name = options.name?.trim();
    if (name) {
      const [firstName, ...rest] = name.split(/\s+/);
      unwrap(
        await this.client.auth.putUserName({
          // An empty last name clears the old one; null would keep it.
          query: { first_name: firstName, last_name: rest.join(' ') },
        }),
      );
    }
  }
}
