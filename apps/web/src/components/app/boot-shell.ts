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
