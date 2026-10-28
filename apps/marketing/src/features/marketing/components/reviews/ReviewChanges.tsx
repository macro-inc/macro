import ArrowsOut from '@phosphor/arrows-out-simple.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import signInHtml from '../../assets/github-signin-0.html?raw';
import testsHtml from '../../assets/github-signin-1.html?raw';
import { ViewShell } from '../DemoWorkspaceChrome';

const files = [
  { path: 'src/auth/SignIn.tsx', html: signInHtml, additions: 3, deletions: 3 },
  {
    path: 'src/auth/SignIn.test.tsx',
    html: testsHtml,
    additions: 11,
    deletions: 0,
  },
];
/** Frozen native Changes header, file selection, and Pierre diff renderer. */
export function ReviewChanges(props: {
  onClose: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const [file, setFile] = createSignal(0);
  const [tree, setTree] = createSignal(false);
  return (
    <section class="github-changes" aria-label="Pull request changes">
      <ViewShell.TopBar>
        <span class="github-branch" title="web-42/mobile-sign-in → main">
          <strong class="github-diff-title">Fix mobile sign-in</strong>
          web-42/mobile-sign-in → main · #491
        </span>
        <span class="text-success text-xs">+14</span>
        <span class="text-failure text-xs">−3</span>
        <Button
          variant="plain"
          size="icon-sm"
          label={
            props.expanded
              ? 'Back to the split'
              : 'Expand changes to the full width'
          }
          onClick={props.onExpand}
        >
          <ArrowsOut />
        </Button>
        <Button
          variant="plain"
          size="icon-sm"
          label="Close the changes pane"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </ViewShell.TopBar>
      <div class="github-diff-tools">
        <Button
          variant="plain"
          size="icon-sm"
          label={tree() ? 'Hide file tree' : 'Show file tree'}
          aria-expanded={tree()}
          onClick={() => setTree(!tree())}
        >
          <Sidebar />
        </Button>
        <span>2 files changed</span>
      </div>
      <Show when={tree()}>
        <nav class="github-file-tree" aria-label="Changed files">
          <For each={files}>
            {(item, index) => (
              <button
                type="button"
                aria-current={file() === index() ? 'true' : undefined}
                onClick={() => {
                  setFile(index());
                  setTree(false);
                }}
              >
                {item.path}
              </button>
            )}
          </For>
        </nav>
      </Show>
      <div class="github-diff-scroll">
        <For each={files}>
          {(item, index) => (
            <div>
              <button
                class="github-file-heading"
                type="button"
                aria-expanded={file() === index()}
                onClick={() => setFile(index())}
              >
                <span>{file() === index() ? '⌄' : '›'}</span>
                <span>{item.path}</span>
                <span class="text-success">+{item.additions}</span>
                <Show when={item.deletions}>
                  <span class="text-failure">−{item.deletions}</span>
                </Show>
              </button>
              <Show when={file() === index()}>
                <FrozenDiff html={item.html} path={item.path} />
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function FrozenDiff(props: { html: string; path: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    host.attachShadow({ mode: 'open' }).innerHTML = props.html;
  });
  return (
    <div
      ref={host}
      class="github-diff-render"
      aria-label={`Changes to ${props.path}`}
      style={{
        '--diffs-font-family': 'var(--font-mono)',
        '--diffs-font-size': '12px',
        '--diffs-line-height': '22px',
        '--diffs-tab-size': '2',
        '--diffs-gap-block': '0',
      }}
    />
  );
}
