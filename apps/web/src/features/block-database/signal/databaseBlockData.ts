import { blockDataSignalAs } from '@core/block';
import type { DatabaseData } from '../definition';

export const databaseBlockDataSignal =
  blockDataSignalAs<DatabaseData>('database');
