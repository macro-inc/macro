import { type JSX, type ParentComponent, splitProps } from 'solid-js';
import { twMerge } from "tailwind-merge";

type ExclusiveVariant<T extends string> = {
  [K in T]: { [P in K]?: true } & { [P in Exclude<T, K>]?: never }
}[T] | { [K in T]?: never };

type ButtonVariant = ExclusiveVariant<'primary' | 'secondary' | 'tertiary' | 'destructive'>;

type DeprecatedButtonProps = ButtonVariant & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button: ParentComponent<DeprecatedButtonProps> = (props) => {
  const [local, ...rest] = splitProps(props, [
    'primary',
    'secondary',
    'tertiary',
    'destructive',
    'class',
    'children',
    'classList',
  ]);
  const classes = twMerge(
    "relative flex items-center justify-center gap-[1ch] px-[1ch] py-[0.25lh] border border-ink",
    "font-mono font-medium uppercase leading-none",
    "hover:opacity-80",
    "focus:[--focus-border-inset:-4px]",
    "active:border-accent active:bg-accent active:text-panel",
    "disabled:opacity-50  disabled:cursor-not-allowed",

    // Anything added by the caller will granularly override
    local.class
  );

  return (
    <button
      class={classes}
      classList={{
        "bg-ink text-panel": !!local.primary,
        "border-transparent": !!local.tertiary,
        "border-failure! text-failure active:bg-failure": !!local.destructive,
        ...(local.classList ?? {}),
      }}
      {...rest}
    >
      {local.children}
    </button>
  );
};
