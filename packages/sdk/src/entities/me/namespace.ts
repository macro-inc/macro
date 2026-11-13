import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { StaticImage } from '../images/image';
import type { ProfilePicture } from '../users/profile-picture';
import { User } from '../users/user';

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
  /**
   * An image from {@link MeNamespace.uploadProfilePicture}. To switch back to
   * an earlier upload without uploading again, pass its handle again, or
   * `macro.images.byId(savedId)`. Setting is throttled to once a second per
   * user; a faster call fails with 429.
   */
  profilePicture?: StaticImage;
}

/**
 * The authenticated user's own profile.
 *
 * @routing Use when changing the user's own name or profile picture; not looking up other people (`macro.users`).
 */
export class MeNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Upload an image to use as your profile picture. This only stores it; pass
   * the result to {@link MeNamespace.update} to start using it. Pictures can be
   * at most 16 MB, and each user can start 20 uploads an hour (more fail with
   * 429). Keep the returned image, or its `id`, to switch back later.
   *
   * @write
   * @mcp-exclude Takes raw image bytes; MCP calls carry JSON only.
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
   * Your current profile picture, read fresh from the auth service.
   *
   * @returns A `StaticImage` for a picture set through Macro (usable with
   * {@link MeNamespace.update}), an `ExternalProfilePicture` for an older
   * picture stored as a bare URL, or `undefined` if you have none.
   *
   * @readonly
   */
  async profilePicture(): Promise<ProfilePicture | undefined> {
    const { user_id } = unwrap(await this.client.auth.getUserInfo());
    return User.byId(this.client, user_id).profilePicture();
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
   * // Later, switch back to it from its saved id:
   * await macro.me.update({ profilePicture: macro.images.byId(savedId) });
   *
   * @write
   * @idempotent
   */
  async update(options: UpdateMeOptions): Promise<void> {
    if (options.profilePicture) {
      const fileId = options.profilePicture.id;
      unwrap(
        await this.client.auth.putProfilePictureFile({
          body: { file_id: fileId },
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
