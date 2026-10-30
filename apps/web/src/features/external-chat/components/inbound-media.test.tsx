import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { InboundMedia } from './inbound-media';

afterEach(cleanup);

it('shows a file that fails to load as unavailable instead of loading forever', () => {
  const { container } = render(() => (
    <InboundMedia
      files={[
        {
          id: 'photo',
          kind: 'image',
          fileName: 'photo.jpg',
          url: 'https://files.example.test/expired-photo',
          width: 800,
          height: 600,
        },
        {
          id: 'voice',
          kind: 'audio',
          fileName: 'voice.ogg',
          url: 'https://files.example.test/expired-voice',
          presentation: 'voice_note',
        },
      ]}
    />
  ));
  const photo = container.querySelector(
    'img[src^="https://files.example.test/expired-photo"]'
  );
  const voice = container.querySelector('audio');
  if (!photo || !voice) throw new Error('media not rendered');
  fireEvent.error(photo);
  fireEvent.error(voice);

  expect(screen.getByText('Attachment unavailable: photo.jpg')).toBeTruthy();
  expect(screen.getByText('Attachment unavailable: voice.ogg')).toBeTruthy();
  expect(
    container.querySelector(
      'img[src^="https://files.example.test/expired-photo"]'
    )
  ).toBeNull();
  expect(container.querySelector('audio')).toBeNull();
});
