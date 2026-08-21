import { stack } from '../../../shared';

/**
 * @deprecated Service images are Nix dockerTools archives pushed by
 * `EcrImage` in `packages/service`. This helper is unused.
 */
export function createImage(
  _serviceName: string,
  _nixImage: string,
  _platform?: string
) {
  throw new Error(
    `createImage is removed; use EcrImage with nixImage (stack=${stack})`
  );
}
