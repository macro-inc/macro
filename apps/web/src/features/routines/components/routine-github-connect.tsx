import GithubIcon from '@icon/mcp-github.svg';
import { Button } from '@ui';

/** Asks for a GitHub link before GitHub triggers can be chosen or run. */
export function RoutineGithubConnect(props: {
  message: string;
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div class="flex flex-col items-start gap-2 px-2 py-2">
      <p class="text-xs text-ink-muted">{props.message}</p>
      <Button
        variant="secondary"
        size="sm"
        disabled={props.connecting}
        onClick={props.onConnect}
      >
        <GithubIcon class="size-3.5" />
        Connect GitHub
      </Button>
    </div>
  );
}
