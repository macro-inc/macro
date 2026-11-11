import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../../vite.base';

// Frozen fixture runs use the actual app plugins without consuming host watchers.
export default defineConfig(async (env) => {
  const app = await createAppViteConfig()(env);
  return { ...app, server: { ...app.server, watch: null } };
});
