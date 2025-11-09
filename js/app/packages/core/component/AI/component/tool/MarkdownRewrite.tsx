import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import Pencil from '@phosphor-icons/core/regular/pencil.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const toolTargetMap: Record<string, string> = {};

export const rewriteHandler = createToolRenderer({
  name: 'MarkdownRewrite',
  handleCall: async (ctx) => {
    // cringe
    toolTargetMap[ctx.tool.id] = ctx.tool.data.markdown_file_id;
  },

  handleResponse: async (ctx) => {
    const orchestrator = useGlobalBlockOrchestrator();
    const targetId = toolTargetMap[ctx.tool.id];
    delete toolTargetMap[ctx.tool.id];
    const { insertSplit } = useSplitLayout();
    insertSplit({ type: 'md', id: targetId });
    const handle = await orchestrator.getBlockHandle(targetId, 'md');
    if (!handle) {
      return;
    }
    handle.setIsRewriting();
    handle.setPatches({ patches: ctx.tool.data.diffs });
  },

  renderCall: (ctx) => (
    <BaseTool
      icon={Pencil}
      text="Rewriting"
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={Pencil}
      text="Rewrite Complete"
      renderContext={ctx.renderContext}
      type="response"
    />
  ),
});
