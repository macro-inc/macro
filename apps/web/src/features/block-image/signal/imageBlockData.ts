import { blockDataSignalAs } from '@core/block';
import type { ImageData } from '../definition';

export const blockDataSignal = blockDataSignalAs<ImageData>('image');
