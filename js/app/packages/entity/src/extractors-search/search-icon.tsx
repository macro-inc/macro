import FileTextIcon from '@icon/regular/file-text.svg';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import type { ContentHitData } from '../types/search';
import { getSearchIcon } from './search-helpers';

interface SearchIconProps {
  hit?: ContentHitData;
  class?: string;
}

/**
 * Displays the appropriate icon for a search content hit
 */
export function SearchIcon(props: SearchIconProps) {
  const icon = () => {
    if (!props.hit) return FileTextIcon;
    return getSearchIcon(props.hit);
  };

  return <Dynamic component={icon()} class={cn('size-4', props.class)} />;
}
