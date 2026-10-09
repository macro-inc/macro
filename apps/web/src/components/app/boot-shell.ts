/**
 * Fades out the static skeleton index.html paints before any JS runs. Called
 * once the app's own frame has mounted, so the screen goes straight from the
 * boot shell to the real shell without a blank frame in between.
 */
export function dismissBootShell(): void {
  const shell = document.getElementById('boot-shell');
  if (!shell || shell.dataset.leaving !== undefined) return;
  shell.dataset.leaving = '';
  const remove = () => shell.remove();
  shell.addEventListener('transitionend', remove, { once: true });
  // transitionend never fires in a background tab or with reduced motion.
  setTimeout(remove, 400);
}

const BOOT_SHELL_HINT_KEY = 'macro:boot-shell';

/** Layout the boot shell in index.html draws on the next load, before JS. */
export type BootShellHint = {
  /** Visible SidebarRail nav item ids, in order. */
  rail?: string[];
  /** Whether the rail shows the Get-the-mobile-app button. */
  mobileApp?: boolean;
  /** Home's composer: the Agents new-chat layout or the legacy greeting. */
  homeComposer?: 'agents' | 'legacy' | 'universal';
};

/** Records part of the current layout for the next load's boot shell. */
export function rememberBootShell(hint: BootShellHint): void {
  try {
    const stored = localStorage.getItem(BOOT_SHELL_HINT_KEY);
    const next = JSON.stringify({ ...parseHint(stored), ...hint });
    if (next !== stored) localStorage.setItem(BOOT_SHELL_HINT_KEY, next);
  } catch {
    // Storage can be unavailable or full; the boot shell has defaults.
  }
}

function parseHint(stored: string | null): BootShellHint {
  try {
    const parsed: unknown = JSON.parse(stored ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
