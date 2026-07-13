import { UserIcon } from '@core/component/UserIcon';

type ThreadReplyAuthorProps = {
  userId: string;
  displayName: string;
};

export function ThreadReplyAuthor(props: ThreadReplyAuthorProps) {
  return (
    <div class="flex items-start gap-2 pt-2 px-2">
      <div class="shrink-0 size-(--user-icon-width)">
        <UserIcon id={props.userId} size="fill" />
      </div>
      <span class="text-sm font-semibold truncate mt-1">
        {props.displayName}
      </span>
    </div>
  );
}
