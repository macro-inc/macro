import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import type { Component } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';

interface UserIconWithContactProps {
  userId: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fill';
  class?: string;
}

export const UserIconWithContact: Component<UserIconWithContactProps> = (
  props
) => {
  const { replaceOrInsertSplit } = useSplitLayout();

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Extract email from user ID
    const email = idToEmail(props.userId);

    // Open contact block with the email
    replaceOrInsertSplit({ type: 'contact', id: email });
  };

  const navHandlers = useSplitNavigationHandler(handleClick);

  return (
    <div {...navHandlers} class="cursor-pointer" title="View contact">
      <UserIcon id={props.userId} size={props.size} isDeleted={false} />
    </div>
  );
};
