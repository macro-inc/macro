import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { StaticImage } from '../images/image';

/** What to change on the authenticated user's profile. */
export interface UpdateMeOptions {
  /** Display name. The first word becomes the first name. */
  name?: string;
  /** An image from `macro.images.upload()`, to use as the profile picture. */
  profilePicture?: StaticImage;
}

/** The authenticated user's own profile. */
export class MeNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Set your display name and profile picture. Agents should do this after
   * signing in, so teammates can tell who they are working with.
   *
   * @example
   * const image = await macro.images.upload(bytes, {
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
          query: { first_name: firstName, last_name: rest.join(' ') || null },
        }),
      );
    }
  }
}
