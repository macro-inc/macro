import Question from '@phosphor-icons/core/regular/question.svg?component-solid';

/**
 * @description This is the view for when a user tries to access an item that returns a 404 indicating it does not exist or it has been deleted.
 */
export default function NotFound() {
  return (
    <div class="flex flex-col items-center justify-center h-full space-y-4">
      <div class="rounded-full">
        <Question class="w-10 h-10" />
      </div>
      <p class="text-ink-muted">
        Whoops! It doesn't look like a file exists at this link.
      </p>
      <span class="text-accent-ink">404</span>
    </div>
  );
}
