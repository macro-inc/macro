import { useIsAuthenticated } from '@core/auth';
import { type ParentProps, Show } from 'solid-js';
import { LoginButton } from './LoginButton';

export function Left(props: ParentProps) {
  const isAuthed = useIsAuthenticated();

  return (
    <div class="flex flex-row w-fit h-8 justify-start items-center gap-2">
      <Show when={!isAuthed()}>
        <LoginButton />
      </Show>
      {props.children}
    </div>
  );
}
