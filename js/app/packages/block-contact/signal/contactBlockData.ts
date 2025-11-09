import { blockDataSignalAs } from '@core/block';
import type { ContactData } from '../definition';

export const blockDataSignal = blockDataSignalAs<ContactData>('contact');
