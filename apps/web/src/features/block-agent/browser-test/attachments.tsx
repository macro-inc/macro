import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { AttachmentPart } from '../component/parts/AttachmentPart';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
const images = [
  'https://cdn.example/images?thumbnail=1&signature=sample',
  'https://cdn.example/file/photo.png',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
];
render(
  () => (
    <main class="mx-auto max-w-xl p-4">
      <p>Look at these images</p>
      <For each={images}>
        {(uri) => (
          <AttachmentPart
            part={{
              kind: 'attachment',
              uri,
              name: 'image.png',
              mimeType: 'image/png',
              size: null,
            }}
          />
        )}
      </For>
    </main>
  ),
  root
);
