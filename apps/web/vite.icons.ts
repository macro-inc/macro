import { resolve } from 'node:path';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { transformMacroSvg } from './src/components/icon/transform-macro-svg';

const iconDir = resolve(__dirname, 'src/components/icon');

export function unpluginIcons() {
  return Icons({
    compiler: 'solid',
    customCollections: {
      macro: FileSystemIconLoader(iconDir, transformMacroSvg),
    },
  });
}
