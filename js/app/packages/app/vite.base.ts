import { execSync, exec } from 'node:child_process';
import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import chokidar from 'chokidar';
import { Features } from 'lightningcss';
import type { Plugin, UserConfigFn } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';

// @ts-ignore
import { version } from './package.json';

function readShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const shortSha = readShortSha();
const appVersion = `${version}+${shortSha}`;

function readGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch {
    return '';
  }
}

function readGitBranchAsync(): Promise<string> {
  return new Promise((res) => {
    exec('git rev-parse --abbrev-ref HEAD', (err, stdout) => {
      res(err ? '' : stdout.trim());
    });
  });
}

function gitBranchHmrPlugin(): Plugin {
  return {
    name: 'git-branch-hmr',
    apply: 'serve',
    configureServer(server) {
      let gitDir: string;
      try {
        gitDir = execSync('git rev-parse --absolute-git-dir').toString().trim();
      } catch {
        return;
      }
      const headPath = resolve(gitDir, 'HEAD');
      const watcher = chokidar.watch(headPath, {
        ignoreInitial: true,
        persistent: false,
        usePolling: true,
        interval: 100,
      });
      watcher.on('all', () => {
        server.ws.send({
          type: 'custom',
          event: 'git-branch:update',
          data: readGitBranch(),
        });
      });
      server.ws.on('connection', () => {
        readGitBranchAsync().then((branch) => {
          server.ws.send({
            type: 'custom',
            event: 'git-branch:update',
            data: branch,
          });
        });
      });
      server.httpServer?.once('close', () => void watcher.close());
    },
  };
}

export const createAppViteConfig = (): UserConfigFn => {
  return ({ command, mode }) => {
    const ENV_MODE = process.env.MODE ?? mode;
    const NO_MINIFY = process.env.NO_MINIFY === 'true';

    return {
      base: command === 'serve' ? '/' : '/app',
      assetsInclude: ['**/*.glb'],
      css: {
        preprocessorMaxWorkers: true,
        transformer: 'lightningcss',
        lightningcss: {
          include: Features.VendorPrefixes,
        },
      },
      plugins: [
        // solidDevtools({ autoname: true }),
        solid(),
        wasm(),
        tailwind(),
        solidSvg({ defaultAsComponent: true }),
        tsconfigpaths({
          root: '../../',
        }),
        gitBranchHmrPlugin(),
      ],
      define: defineEnv(ENV_MODE, command),
      clearScreen: false,
      worker: {
        format: 'es',
        plugins: () => [
          tsconfigpaths({
            root: '../../',
          }),
        ],
        rollupOptions: {
          output: {
            format: 'es',
            chunkFileNames: '[name]-[hash].js',
            entryFileNames: '[name]-[hash].js',
          },
        },
      },
      mode: ENV_MODE,
      build: {
        cssMinify: 'lightningcss',
        // target older safari to avoid lightningcss using text-decoration shorthand:
        // https://developer.mozilla.org/en-US/docs/Web/CSS/text-decoration#browser_compatibility
        cssTarget: ['esnext', 'safari15'],
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true,
        minify: !NO_MINIFY,
        rollupOptions: {
          input: {
            app: resolve(__dirname, 'index.html'),
          },
          output: NO_MINIFY
            ? {
                // remove hashes from output paths
                // https://github.com/vitejs/vite/issues/378
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
                manualChunks: {
                  katex: ['katex'],
                  pdfjs: ['pdfjs-dist'],
                },
              }
            : {
                format: 'es',
                chunkFileNames: '[name]-[hash].js',
                entryFileNames: '[name]-[hash].js',
                manualChunks: {
                  katex: ['katex'],
                  pdfjs: ['pdfjs-dist'],
                },
              },
        },
        assetsInlineLimit: (filePath) => {
          if (filePath.includes('.wasm')) return false;
          if (filePath.includes('/lok/')) return false;
        },
        sourcemap: true,
      },
      esbuild: {
        supported: {
          'top-level-await': true,
        },
        jsx: 'automatic',
        jsxImportSource: 'solid-js',
      },
      optimizeDeps: {
        include: [
          'vscode-textmate',
          'vscode-oniguruma',
          // 'solid-devtools/setup',
          'libheif-js/wasm-bundle',
        ],
        esbuildOptions: {
          target: 'esnext',
        },
      },
      resolve: {
        dedupe: [
          '@codingame/monaco-vscode-api',
          '@codingame/monaco-vscode-*-common',
        ],
      },
      server: {
        port: Number(process.env.PORT || 3000),
        host: '0.0.0.0',
        strictPort: true,
        hmr: {
          protocol: 'ws',
          host: process.env.TAURI_DEV_HOST || 'localhost',
        },
        cors: true,
        watch: {
          usePolling: true,
          interval: 100,
        },
        fs: {
          allow: [
            // Allow serving files from the workspace root
            resolve(__dirname, '../../../'),
          ],
        },
      },
    };
  };
};

function getAssetsPath(mode: string, command: string): string {
  switch (mode) {
    case 'development':
      return command === 'serve' ? '/local' : '/dev';
    case 'staging':
      return '/staging';
    default:
      return '/';
  }
}

function defineEnv(mode: string, command: string) {
  return {
    'import.meta.env.__APP_VERSION__': JSON.stringify(appVersion),
    'import.meta.env.ASSETS_PATH': JSON.stringify(getAssetsPath(mode, command)),
    'import.meta.env.__LOCAL_DOCKER__': process.env.LOCAL_DOCKER === 'true',
    'import.meta.env.__LOCAL_JWT__': JSON.stringify(process.env.LOCAL_JWT),
    'import.meta.env.__GIT_BRANCH__': JSON.stringify(
      command === 'serve' ? readGitBranch() : ''
    ),
  };
}
