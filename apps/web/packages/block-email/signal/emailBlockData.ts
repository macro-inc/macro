import { blockDataSignalAs } from '@core/block';
import type { EmailData } from '../definition';

export const blockDataSignal = blockDataSignalAs<EmailData>('email');
