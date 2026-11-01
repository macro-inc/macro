import { z } from 'zod';

/** Read a claim only. SyncService must verify this same token before any model or write runs. */
export function tokenAccessLevel(token: string): string | undefined {
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = z
      .object({ access_level: z.string() })
      .safeParse(
        JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      );
    return claims.success ? claims.data.access_level : undefined;
  } catch {
    return undefined;
  }
}
