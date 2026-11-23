import { afterEach, describe, expect, it } from 'vitest';
import {
  trackUpload,
  type UploadProgressHandle,
  uploadProgress,
} from './uploadProgress';

const handles: UploadProgressHandle[] = [];
function track(name: string, size: number) {
  const handle = trackUpload(name, size);
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.done();
});

describe('uploadProgress', () => {
  it('is empty when nothing is uploading', () => {
    expect(uploadProgress()).toBeNull();
  });

  it('spins while preparing, then reports bytes sent', () => {
    const upload = track('Report', 200);
    expect(uploadProgress()).toEqual({
      label: 'Preparing Report',
      fraction: null,
    });

    upload.sending(50);
    expect(uploadProgress()).toEqual({
      label: 'Uploading Report',
      fraction: 0.25,
    });
  });

  it('reports how much of a folder has been read while preparing', () => {
    const upload = track('Archive', 0);
    upload.preparing(0.4);
    expect(uploadProgress()).toEqual({
      label: 'Preparing Archive',
      fraction: 0.4,
    });
  });

  it('spins while the server processes the sent file', () => {
    const upload = track('Report', 200);
    upload.sending(200);
    upload.processing();
    expect(uploadProgress()).toEqual({
      label: 'Processing Report',
      fraction: null,
    });
  });

  it('follows the server once it reports how much it has processed', () => {
    const upload = track('Archive', 200);
    upload.sending(200);
    upload.processing(null);
    upload.processing(0.75);
    expect(uploadProgress()).toEqual({
      label: 'Processing Archive',
      fraction: 0.75,
    });
  });

  it('spins when the transport cannot measure bytes', () => {
    track('Photo', 100).sending(null);
    expect(uploadProgress()?.fraction).toBeNull();
  });

  it('combines concurrent uploads by bytes', () => {
    const first = track('Report', 100);
    const second = track('Deck', 300);
    const third = track('Notes', 100);
    first.sending(100);
    first.processing();
    second.sending(150);

    expect(uploadProgress()).toEqual({
      label: 'Uploading 3 files',
      fraction: 0.5,
    });

    third.done();
    expect(uploadProgress()?.label).toBe('Uploading 2 files');
    expect(uploadProgress()?.fraction).toBe(250 / 400);
  });

  it('names the stage several uploads share', () => {
    const first = track('Archive', 100);
    const second = track('Scans', 100);
    first.sending(100);
    first.processing();
    second.sending(100);
    second.processing();

    expect(uploadProgress()?.label).toBe('Processing 2 files');
  });

  it('drops an upload once it is done', () => {
    const upload = track('Report', 100);
    upload.done();
    upload.done();
    expect(uploadProgress()).toBeNull();
  });

  it('never reports more than every byte', () => {
    track('Report', 100).sending(150);
    expect(uploadProgress()?.fraction).toBe(1);
  });
});
