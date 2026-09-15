import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createContext,
  type JSX,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

export const MarkdownShellContext = createContext<{
  connectRoot: (element: HTMLDivElement) => void;
  disabled: Accessor<boolean>;
  showPlaceholder: Accessor<boolean>;
  placeholder: Accessor<string>;
}>();

function useMarkdownShell() {
  const context = useContext(MarkdownShellContext);
  if (!context) {
    throw new Error(
      'MarkdownShell parts must be rendered inside MarkdownShell'
    );
  }
  return context;
}

export type MarkdownEditableProps = Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'children' | 'contentEditable' | 'ref'
>;

/** Lexical owns the editable element's contents and lifecycle. */
export function MarkdownEditable(props: MarkdownEditableProps) {
  const context = useMarkdownShell();
  return (
    <div
      {...props}
      ref={context.connectRoot}
      contentEditable={!context.disabled()}
    />
  );
}

export type MarkdownPlaceholderProps = Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'children'
> & {
  children?: (text: Accessor<string>) => JSX.Element;
};

export function MarkdownPlaceholder(props: MarkdownPlaceholderProps) {
  const context = useMarkdownShell();
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <Show when={context.showPlaceholder()}>
      <div
        {...rest}
        class={cn(
          'pointer-events-none text-ink-placeholder absolute top-0',
          local.class
        )}
      >
        {local.children ? (
          local.children(context.placeholder)
        ) : (
          <p class="my-1.5 pointer-events-none">{context.placeholder()}</p>
        )}
      </div>
    </Show>
  );
}
