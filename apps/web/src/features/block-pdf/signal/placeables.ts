import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '@block-pdf/type/placeables';
import { createBlockSignal } from '@core/block';

export const placeableModeSignal = createBlockSignal<PayloadType>(
  PayloadMode.NoMode
);
export const showTabBarSignal = createBlockSignal<boolean>(false);
export const activePlaceableIdSignal = createBlockSignal<string>();
export const newPlaceableSignal = createBlockSignal<IPlaceable>();
