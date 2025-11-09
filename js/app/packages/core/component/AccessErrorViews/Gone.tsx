import Question from '@icon/regular/question.svg';

/**
 * @description This is the view for when a user tries to access an item that returns a 410 indicating it was not successfully uploaded.
 */
export default function Gone() {
  return (
    <div class="flex flex-col items-center justify-center h-full space-y-4">
      <div class="rounded-full">
        <Question class="w-10 h-10" />
      </div>
      <p class="text-ink-muted text-center max-w-xs">
        Whoops! It looks like the file was not successfully uploaded.
      </p>
      <span class="text-accent-ink">410</span>
    </div>
  );
}
