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

/**
 * A static file link: `<base>/file/<uuid>`. The base is the public static file
 * address the auth service stamps, which can differ from the SDK's
 * `static-files` host (a local stack's proxy), so only the path is matched.
 */
const STATIC_FILE_PATH =
  /\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** Read a picture row; an empty URL means the user has no picture. */
export function toProfilePicture(
  client: MacroClient,
  row: UserProfilePicture | undefined,
): ProfilePicture | undefined {
  const url = row?.url?.trim();
  if (!url) return undefined;
  const id = URL.parse(url)?.pathname.match(STATIC_FILE_PATH)?.[1];
  return id ? StaticImage.byId(client, id) : new ExternalProfilePicture(url);
}
