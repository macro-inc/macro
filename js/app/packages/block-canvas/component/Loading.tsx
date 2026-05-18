import Spinner from '@phosphor/circle-notch.svg';
export function Loading() {
  return (
    <div class="flex flex-col items-center justify-center h-full">
      <div class="animate-spin">
        <Spinner class="size-16 text-edge" />
      </div>
    </div>
  );
}
