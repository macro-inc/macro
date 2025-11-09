import { nanoid } from 'nanoid';
import { LoadingPanel } from './LoadingSpinner';

export function LoadingBlock() {
  return (
    <div class="relative flex flex-col size-full select-none">
      <div class="overflow-hidden size-full">
        <LoadingPanel blockId={nanoid(32)} />
      </div>
    </div>
  );
}
