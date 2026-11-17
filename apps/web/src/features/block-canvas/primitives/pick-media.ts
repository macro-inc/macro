import { pickPhotoLibraryMediaOrFiles } from '@core/mobile/nativePhotoLibrary';

/** What a canvas takes as media. HEIC photos often arrive without a type. */
const ACCEPT = 'image/*,video/*,.heic,.heif';

// The input of the picker that has not answered yet. iOS reports nothing when
// its menu of sources is dismissed, so the next picker clears it away.
let unanswered: HTMLInputElement | undefined;

/**
 * A file picker on an input of its own. The input stays in the document until
 * the picker answers: WebKit drops a picker's result when it collects a
 * detached input while the picker is open, and the menu that asked for the
 * files has usually closed by then.
 */
function openFileInput(onFiles: (files: File[]) => void) {
  unanswered?.remove();
  const input = document.createElement('input');
  unanswered = input;
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.hidden = true;
  input.setAttribute('aria-label', 'Upload media');
  const answered = () => {
    input.remove();
    if (unanswered === input) unanswered = undefined;
  };
  input.addEventListener('cancel', answered);
  input.addEventListener('change', () => {
    answered();
    const files = Array.from(input.files ?? []);
    if (files.length) onFiles(files);
  });
  document.body.append(input);
  input.click();
}

/**
 * Ask the device for images or videos to put on the canvas: the photo library
 * in the iOS app, a file picker everywhere else. `onFiles` runs once something
 * is chosen, and never for a picker that was dismissed.
 *
 * Call it inside the tap or click that asks: a browser opens a file picker
 * only then.
 */
export async function pickCanvasMedia(onFiles: (files: File[]) => void) {
  const files = await pickPhotoLibraryMediaOrFiles(() =>
    openFileInput(onFiles)
  );
  if (files.length) onFiles(files);
}
