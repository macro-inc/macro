import Copy from '@phosphor/copy.svg';
import { Button } from '@ui';

export function MeetingLink(props: {
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div class="ph-no-capture flex min-w-0 items-center gap-2 rounded-lg border border-edge-muted bg-input px-3 py-2">
      <input
        class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
        aria-label="Call link"
        readOnly
        value={props.url}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button size="sm" onClick={props.onCopy} aria-label="Copy call link">
        <Copy class="size-4" />
        {props.copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}
