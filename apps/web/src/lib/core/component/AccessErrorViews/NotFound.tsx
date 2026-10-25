import Question from '@phosphor-icons/core/regular/question.svg?component-solid';

/**
 * @description This is the view for when a user tries to access an item that returns a 404 indicating it does not exist or it has been deleted.
 * `message` names the item when it is not a file, such as a calendar event.
 */
export default function NotFound(props: { message?: string }) {
  return (
    <div class="flex flex-col items-center justify-center h-full space-y-4">
      <div class="rounded-full">
        <Question class="size-10" />
      </div>
      <p class="text-ink-muted">
        {props.message ??
          "Whoops! It doesn't look like a file exists at this link."}
      </p>
      <span class="text-accent">404</span>
    </div>
  );
}
