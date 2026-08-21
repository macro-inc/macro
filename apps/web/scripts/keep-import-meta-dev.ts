/**
 * Whether a `vite build` should keep `import.meta.env.DEV` true.
 *
 * Vite compiles DEV from NODE_ENV, not MODE, so
 * `MODE=development NODE_ENV=production vite build` would otherwise ship
 * DEV=false. Local-backend bundles (`just stack up`, Fly preview) already set
 * `VITE_LOCAL_BACKEND_ORIGIN`; hosted `just build-dev` / staging / prod do not.
 *
 * `vite serve` already has DEV=true, so this only applies to `build`.
 */
export function keepImportMetaDev(opts: {
  command: string;
  mode: string;
  localBackendOrigin: string | undefined;
}): boolean {
  const hasOrigin = Boolean(opts.localBackendOrigin);
  if (hasOrigin && opts.mode !== 'development') {
    throw new Error(
      `VITE_LOCAL_BACKEND_ORIGIN is set on MODE=${opts.mode}; refusing to keep import.meta.env.DEV`
    );
  }
  return opts.command === 'build' && opts.mode === 'development' && hasOrigin;
}
