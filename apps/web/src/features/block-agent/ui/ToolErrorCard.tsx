import Prohibit from '@phosphor/prohibit.svg';
import { FoldedOutput } from './FoldedOutput';
import { ToolCard } from './ToolCard';

export interface ToolErrorCardProps {
  tool: string;
  error: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Failures use the same disclosure and inspectable output as successful tools. */
export function ToolErrorCard(props: ToolErrorCardProps) {
  return (
    <ToolCard
      title={props.tool}
      icon={<Prohibit class="size-4" />}
      status="failed"
      trailing={<span class="text-failure">Failed</span>}
      subtitle={props.error.split('\n')[0]}
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
    >
      <div class="p-3">
        <FoldedOutput label="Error" text={props.error} />
      </div>
    </ToolCard>
  );
}
