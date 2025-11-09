import EnvelopSimple from '@icon/regular/envelope-simple.svg';
import { CustomEntityIcon } from 'core/component/EntityIcon';

interface EmailCommandItemProps {
  sender: string;
  subject: string;
}

export function EmailCommandItem(props: EmailCommandItemProps) {
  return (
    <div class="w-full flex items-center ml-auto text-ink-extra-muted h-5">
      <div class="mr-2">
        <CustomEntityIcon icon={EnvelopSimple} size="sm" />
      </div>
      <div class="w-1/4 text-ink truncate sm:text-sm text-xs font-medium">
        {props.sender}
      </div>
      <div class="flex-1 ml-4 text-ink truncate sm:text-sm text-xs font-medium">
        {props.subject}
      </div>
    </div>
  );
}
