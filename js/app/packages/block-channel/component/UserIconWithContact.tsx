import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
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

  return (
    <div
      onMouseDown={(e) => {
        // Prevent focus change on mousedown to avoid split activation flash
        // The click handler will properly handle navigation
        e.preventDefault();
      }}
      onClick={handleClick}
      class="cursor-pointer"
      title="View contact"
    >
      <UserIcon id={props.userId} size={props.size} isDeleted={false} />
    </div>
  );
};
