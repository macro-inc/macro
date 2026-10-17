import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function copyExtensionFiles(): Plugin {
  return {
    name: 'copy-extension-files',
    writeBundle() {
      const srcDir = resolve(__dirname, 'src');
      const distDir = resolve(__dirname, 'dist');
      const distSrcDir = resolve(distDir, 'src');

      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'));

      copyFileSync(resolve(srcDir, 'content.css'), resolve(distDir, 'content.css'));

      const localesDir = resolve(__dirname, '_locales');
      const distLocalesDir = resolve(distDir, '_locales');
      cpSync(localesDir, distLocalesDir, { recursive: true });

      const iconsDir = resolve(__dirname, 'icons');
      const distIconsDir = resolve(distDir, 'icons');
      mkdirSync(distIconsDir, { recursive: true });
      cpSync(iconsDir, distIconsDir, { recursive: true });

      if (existsSync(resolve(distSrcDir, 'popup.html'))) {
        renameSync(resolve(distSrcDir, 'popup.html'), resolve(distDir, 'popup.html'));
      }
      if (existsSync(resolve(distSrcDir, 'options.html'))) {
        renameSync(resolve(distSrcDir, 'options.html'), resolve(distDir, 'options.html'));
      }
      if (existsSync(distSrcDir)) {
        rmSync(distSrcDir, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirFirst: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.html'),
        options: resolve(__dirname, 'src/options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV !== 'development',
  },
  publicDir: false,
  plugins: [copyExtensionFiles()],
});
