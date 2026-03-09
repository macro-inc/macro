import { UserIcon } from '@core/component/UserIcon';

type ThreadReplyAuthorProps = {
  userId: string;
  displayName: string;
};

export function ThreadReplyAuthor(props: ThreadReplyAuthorProps) {
  return (
    <div class="flex items-start gap-2 p-2">
      <div class="flex-shrink-0 size-[var(--user-icon-width)]">
        <UserIcon id={props.userId} size="fill" />
      </div>
      <span class="text-sm font-semibold truncate mt-1">
        {props.displayName}
      </span>
    </div>
  );
}
