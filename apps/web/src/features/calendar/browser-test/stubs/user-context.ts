export const VIEWER_ID = 'macro|viewer@example.com';

export function useUserId() {
  return () => VIEWER_ID;
}
export function useEmail() {
  return () => 'viewer@example.com';
}
