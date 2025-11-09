import CheckIcon from '@icon/regular/check.svg';
import XIcon from '@icon/regular/x.svg';
import { DiffNode, setDOMFactory } from '@lexical-core';
import { useUserId } from '@service-gql/client';
import { render } from 'solid-js/web';

export function registerDiffNodeFactory() {
  setDOMFactory(DiffNode, (node, _config, editor) => {
    const userId = useUserId();
    const container = document.createElement('div');
    container.classList.add('md-diff');

    if (node.__userId !== userId()) {
      container.classList.add('external');
      return container;
    }

    container.contentEditable = true.toString();
    container.classList.add('flex', 'flex-col-reverse');

    const child = document.createElement('div');
    container.appendChild(child);

    const handleAccept = () => {
      node.handleAccept(editor);
    };

    const handleReject = () => {
      node.handleReject(editor);
    };

    render(() => {
      return (
        <div
          class="select-none flex justify-between items-center gap-2 p-1 mb-2 bg-edge/15"
          contentEditable={false}
        >
          <div class="flex-1 text-sm text-ink-extra-muted ml-1 truncate">
            {node.getLabel()}
          </div>
          <div class="flex gap-1">
            <button
              class="px-2 py-0.5 rounded text-sm flex border-1 border-edge bg-edge/30 items-center gap-2 hover:bg-hover hover-transition-bg"
              onClick={handleReject}
              onMouseEnter={() =>
                container.classList.toggle('opt-reject', true)
              }
              onMouseLeave={() => {
                container.classList.toggle('opt-reject', false);
              }}
            >
              <XIcon class="size-4 text-failure" />
              Reject
            </button>
            <button
              class="px-2 py-0.5 rounded text-sm flex border-1 border-edge bg-edge/30 items-center gap-2 hover:bg-hover hover-transition-bg"
              onClick={handleAccept}
              onMouseEnter={() =>
                container.classList.toggle('opt-accept', true)
              }
              onMouseLeave={() => {
                container.classList.toggle('opt-accept', false);
              }}
            >
              <CheckIcon class="size-4 text-success" />
              Accept
            </button>
          </div>
        </div>
      );
    }, child);
    return container;
  });
}
