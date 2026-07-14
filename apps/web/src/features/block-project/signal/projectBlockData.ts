import { blockDataSignalAs } from '@core/block';
import type { ProjectData } from '../definition';

export const projectBlockDataSignal = blockDataSignalAs<ProjectData>('project');
