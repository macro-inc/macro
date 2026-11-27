import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../../vite.base';

export default defineConfig(async (env) => {
  const app = await createAppViteConfig()(env);
  return {
    ...app,
    server: { ...app.server, hmr: false, proxy: undefined },
  };
});
