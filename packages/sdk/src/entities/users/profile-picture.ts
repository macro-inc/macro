import type { UserProfilePicture } from '../../../generated/auth/types.gen';
import type { MacroClient } from '../../utils/client';
import { StaticImage } from '../images/image';

/**
 * A profile picture that is not in static file storage: an older picture
 * stored as a plain URL (such as a sign-in provider's avatar). It can be shown
 * but not passed to `macro.me.update()`.
 */
export class ExternalProfilePicture {
  /** @internal */
  constructor(
    /** URL of the image bytes. */
    readonly url: string,
  ) {}

  /** Serialize the picture URL. */
  toJSON() {
    return { url: this.url };
  }
}

/**
 * A user's profile picture. Pictures set through Macro are a
 * {@link StaticImage}; older pictures stored as a bare URL are an
 * {@link ExternalProfilePicture}. Narrow with `instanceof StaticImage`; both
 * have a `url`.
 */
export type ProfilePicture = StaticImage | ExternalProfilePicture;

/** Read a picture row; an empty URL means the user has no picture. */
export function toProfilePicture(
  client: MacroClient,
  row: UserProfilePicture | undefined,
): ProfilePicture | undefined {
  const url = row?.url?.trim();
  if (!url) return undefined;
  const prefix = `${client.hosts['static-files']}/file/`;
  if (url.startsWith(prefix)) {
    const id = url.slice(prefix.length).split(/[/?#]/)[0];
    if (id) return StaticImage.byId(client, id);
  }
  return new ExternalProfilePicture(url);
}
