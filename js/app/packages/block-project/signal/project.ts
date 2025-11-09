import { createBlockSignal } from '@core/block';
import type { Project } from '@service-storage/generated/schemas/project';

export const projectSignal = createBlockSignal<Project>();
