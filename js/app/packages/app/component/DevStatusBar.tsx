import GitBranchIcon from '@icon/git-branch.svg';
import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal, Show } from 'solid-js';

const PORT_COLORS = [
  '#2563eb', // blue - 3000
  '#059669', // green - 3001
  '#d97706', // amber - 3002
  '#dc2626', // red - 3003
  '#7c3aed', // violet - 3004
  '#db2777', // pink - 3005
  '#0891b2', // cyan - 3006
  '#ea580c', // orange - 3007
  '#65a30d', // lime - 3008
  '#0d9488', // teal - 3009
];

export const [gitBranch, setGitBranch] = createSignal<string>(
  import.meta.env.__GIT_BRANCH__ ?? ''
);

if (import.meta.env.DEV && import.meta.hot) {
  import.meta.hot.on('git-branch:update', (data: string) => setGitBranch(data));
}

export const [devStatusBarOpen, setDevStatusBarOpen] = makePersisted(
  createSignal<boolean>(false),
  { name: 'dev-status-bar-open' }
);

export const DevStatusBar = () => {
  const portInfo = createMemo(() => {
    if (typeof window === 'undefined') return null;
    const port = window.location.port || '80';
    const portNum = Number.parseInt(port, 10);
    const colorIndex = portNum >= 3000 ? portNum - 3000 : 0;
    const color = PORT_COLORS[colorIndex % PORT_COLORS.length];
    return { port, color };
  });

  return (
    <Show when={import.meta.env.DEV && devStatusBarOpen() && gitBranch()}>
      {(branch) => (
        <div class="shrink-0 flex items-center gap-1.5 pb-2 px-4 text-[0.6875rem] text-ink-muted select-none">
          <GitBranchIcon class="size-3 shrink-0" />
          <span class="truncate font-mono">{branch()}</span>
          <Show when={portInfo()}>
            {(info) => (
              <span
                class="px-1.5 py-0.5 rounded font-mono font-medium"
                style={{
                  'background-color': info().color,
                  color: 'white',
                }}
              >
                :{info().port}
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};
