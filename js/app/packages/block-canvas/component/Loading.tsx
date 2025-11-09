import Spinner from '@icon/regular/circle-notch.svg';
export function Loading() {
  return (
    <div class="flex flex-col items-center justify-center h-full">
      <div class="animate-spin">
        <Spinner class="w-16 h-16 text-edge" />
      </div>
    </div>
  );
}
