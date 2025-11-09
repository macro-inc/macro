export function isLocal() {
  return !!import.meta.hot;
}
