import { type JSX, type ParentProps, splitProps } from 'solid-js';

interface EntityWrapperProps extends JSX.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

export function EntityWrapper(props: ParentProps<EntityWrapperProps>) {
  const [localProps, divProps] = splitProps(props, [
    'selected',
    'class',
    'classList',
  ]);

  return (
    <div
      class="flex min-h-19 w-full flex-row items-center gap-1 px-1 transition-all hover:bg-hover transition-none sm:min-h-13.5 sm:gap-2.5 sm:px-5 suppress-css-brackets"
      classList={{ 'bracket bg-hover': localProps.selected }}
      {...divProps}
    >
      {divProps.children}
    </div>
  );
}
