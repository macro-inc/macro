import GitBranchIcon from "@icon/regular/git-branch.svg";
import { makePersisted } from "@solid-primitives/storage";
import { createSignal, Show } from "solid-js";

export const [gitBranch, setGitBranch] = createSignal<string>(
	import.meta.env.__GIT_BRANCH__ ?? "",
);

if (import.meta.env.DEV && import.meta.hot) {
	import.meta.hot.on("git-branch:update", (data: string) => setGitBranch(data));
}

export const [devStatusBarOpen, setDevStatusBarOpen] = makePersisted(
	createSignal<boolean>(false),
	{ name: "dev-status-bar-open" },
);

export const DevStatusBar = () => {
	return (
		<Show when={import.meta.env.DEV && devStatusBarOpen() && gitBranch()}>
			{(branch) => (
				<div class="shrink-0 flex bg-[blue] items-center gap-1.5 py-2 px-4 text-[0.6875rem] text-ink-muted select-none">
					<GitBranchIcon class="size-3 shrink-0" />
					<span class="truncate font-mono">{branch()}</span>
				</div>
			)}
		</Show>
	);
};
