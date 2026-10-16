import { ItemPreview } from '@core/component/ItemPreview';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg';
import { Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

function CallPreview(props: { callId: string }) {
  return (
    <Suspense>
      <ItemPreview
        class="inline-flex align-middle ring-0"
        id={props.callId}
        type="call"
      />
    </Suspense>
  );
}

export const updateCallRecordHandler = createToolRenderer({
  name: 'UpdateCallRecord',
  render: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        <Show
          when={ctx.response?.data.summary}
          fallback={
            <>
              Update <CallPreview callId={ctx.tool.data.callId} />
            </>
          }
        >
          {(summary) => (
            <>
              <CallPreview callId={ctx.tool.data.callId} />{' '}
              <span class="text-ink">{summary()}</span>
            </>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const deleteCallRecordHandler = createToolRenderer({
  name: 'DeleteCallRecord',
  render: (ctx) => (
    <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        {ctx.response ? 'Deleted' : 'Delete'}{' '}
        <CallPreview callId={ctx.tool.data.callId} />
      </div>
    </BaseTool>
  ),
});
