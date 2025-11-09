import { blockDataSignalAs } from '@core/block';
import type { ColorBlockData } from './definition';

export const colorBlockDataSignal = blockDataSignalAs<ColorBlockData>('color');
