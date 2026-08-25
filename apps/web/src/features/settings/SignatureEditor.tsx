import 'quill/dist/quill.snow.css';
import './SignatureEditor.css';
import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import {
  createStaticUploadFile,
  createUploadFile,
} from '@core/util/uploadFile';
import { Tooltip } from '@ui';
import Quill, { type Parchment } from 'quill';
import { createEffect, For, onCleanup, onMount } from 'solid-js';
import { pastedHyperlinkHref } from './pastedHyperlinkHref';
import { setupImageResizer } from './signatureImageResizer';

// Quill's built-in font/size formats ship with hard whitelists (font:
// serif/monospace; size: 10/18/32px), and the paste clipboard enforces them —
// so any other pasted font-family / font-size is silently dropped. Swap in the
// style-based attributors with the whitelist cleared, so pasted fonts and sizes
// are kept as inline styles (which the backend HTML sanitizer allows). The
// clipboard matches against these exact singletons, so clearing their whitelist
// is what makes paste retain arbitrary values. Runs once when this lazy chunk
// loads; registration is global and idempotent.
for (const path of ['attributors/style/font', 'attributors/style/size']) {
  const attributor = Quill.import(path) as Parchment.Attributor;
  attributor.whitelist = undefined;
  Quill.register(attributor, true);
}

// Font/size options offered in the toolbar. The style attributors registered
// above apply these as inline `font-family` / `font-size` (which the sanitizer
// keeps), and `false` is the "default" reset. Each value needs a matching label
// rule in SignatureEditor.css (the snow theme only ships labels for its own
// presets). Values with spaces are valid multi-identifier CSS family names.
const FONT_OPTIONS: (string | false)[] = [
  false,
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
];
const SIZE_OPTIONS: (string | false)[] = [
  false,
  '12px',
  '14px',
  '16px',
  '20px',
  '24px',
];

// Image types accepted by the toolbar picker and by paste/drop upload.
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// A toolbar button wrapped in the app's tooltip. `as="span"` keeps the wrapper
// inline so Quill still finds the <button> inside and wires its handler/icon.
// `aria-label` gives the icon-only button an accessible name.
function ToolbarButton(props: {
  format: string;
  value?: string;
  label: string;
  shortcut?: string;
}) {
  return (
    <Tooltip label={props.label} shortcut={props.shortcut} as="span">
      <button
        type="button"
        class={`ql-${props.format}`}
        value={props.value}
        aria-label={props.label}
      />
    </Tooltip>
  );
}

export default function SignatureEditor(props: {
  /** Persisted signature HTML. Seeds the editor, and reseeds it (while blurred)
   * if it changes externally — e.g. the links query resolves after mount. */
  value: string;
  /** Fires with the editor's current HTML on every edit; '' when emptied. */
  onInput: (html: string) => void;
  placeholder?: string;
  /** Exposes an imperative handle once mounted so commit actions (Save/Remove)
   * can set the editor content deterministically, not via the reactive value. */
  onReady?: (handle: { setContent: (html: string) => void }) => void;
}) {
  let toolbarEl!: HTMLDivElement;
  let editorEl!: HTMLDivElement;
  let quill: Quill | undefined;
  let teardownResizer: (() => void) | undefined;

  const currentHtml = (): string => {
    if (!quill) return '';
    // A blank editor still serializes to "<p></p>"; treat it as empty so the
    // caller can clear the signature (the backend reads '' as "clear"). Inspect
    // the delta rather than getText(), which omits embeds — an image-only
    // signature has no text but must still be saved.
    const ops = quill.getContents().ops ?? [];
    const hasContent = ops.some((op) =>
      typeof op.insert === 'string'
        ? op.insert.trim().length > 0
        : op.insert != null
    );
    if (!hasContent) return '';
    // Quill emits one bare <p> per line (and bare <ul>/<ol> for lists). The
    // sent email carries no stylesheet, so recipients' clients would apply
    // their default ~1em block margins (the editor and previews zero them via
    // app CSS) — inline margin:0 so the wire format matches what the editor
    // shows.
    const doc = new DOMParser().parseFromString(
      quill.getSemanticHTML(),
      'text/html'
    );
    for (const el of doc.body.querySelectorAll<HTMLElement>('p, ul, ol')) {
      el.style.setProperty('margin', '0');
      // getSemanticHTML drops the placeholder <br> from blank lines, and with
      // margins zeroed an empty <p> collapses to nothing — put the <br> back so
      // blank separator lines keep their one-line height in the sent email.
      if (
        el.tagName === 'P' &&
        !el.textContent &&
        !el.querySelector('br, img')
      ) {
        el.append(doc.createElement('br'));
      }
    }
    return doc.body.innerHTML;
  };

  const setHtml = (html: string) => {
    if (!quill) return;
    // 'silent' so seeding/reseeding doesn't fire text-change (which would call
    // onInput and falsely mark the form dirty). For empty html clear explicitly:
    // Quill's convert('') yields an empty delta that setContents leaves as a
    // no-op, so it wouldn't actually clear an existing signature.
    if (!html) {
      quill.setContents([{ insert: '\n' }], 'silent');
      return;
    }
    const delta = quill.clipboard.convert({ html });
    quill.setContents(delta, 'silent');
  };

  // Uploads each image to the static-file-service and inserts it at `index` as
  // an <img> with the returned https URL. We never insert base64 `data:` URLs —
  // the signature sanitizer's url_schemes allowlist rejects them.
  const uploadAndInsertImages = async (
    index: number,
    length: number,
    files: File[]
  ) => {
    if (!quill) return;
    if (length > 0) quill.deleteText(index, length, 'user');
    let at = index;
    for (const file of files) {
      try {
        const id = await createStaticUploadFile(createUploadFile(file));
        quill.insertEmbed(at, 'image', staticFileIdEndpoint(id), 'user');
        at += 1;
      } catch {
        toast.failure('Failed to upload image');
      }
    }
    quill.setSelection(at, 0, 'silent');
  };

  // Toolbar image button: pick a file, then upload + insert at the cursor.
  const pickAndUploadImage = () => {
    if (!quill) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_MIME_TYPES.join(',');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file || !quill) return;
      const index = quill.getSelection(true)?.index ?? quill.getLength();
      void uploadAndInsertImages(index, 0, [file]);
    });
    input.click();
  };

  onMount(() => {
    // Hand Quill our own JSX toolbar (each control wrapped in the app Tooltip)
    // instead of the array config, so the buttons get the app's styled tooltips.
    // Quill still builds the icons/pickers into it and wires the default handlers.
    quill = new Quill(editorEl, {
      theme: 'snow',
      placeholder: props.placeholder ?? 'Add a signature…',
      modules: {
        toolbar: {
          container: toolbarEl,
          handlers: { image: pickAndUploadImage },
        },
        // Route pasted/dropped images through SFS instead of Quill's default
        // base64 insert (which the sanitizer would strip).
        uploader: {
          mimetypes: IMAGE_MIME_TYPES,
          handler: (range: { index: number; length: number }, files: File[]) =>
            void uploadAndInsertImages(range.index, range.length, files),
        },
      },
    });
    setHtml(props.value);
    quill.on('text-change', () => props.onInput(currentHtml()));
    teardownResizer = setupImageResizer(quill);
    props.onReady?.({ setContent: (html) => setHtml(html) });

    // Capture before Quill replaces the selection. A protocol URL on a range
    // becomes a hyperlink on those words.
    const onPaste = (event: ClipboardEvent) => {
      if (!quill) return;
      const range = quill.getSelection();
      const href = pastedHyperlinkHref({
        clipboardPlainText: event.clipboardData?.getData('text/plain') ?? '',
        selectionCollapsed: range == null || range.length === 0,
      });
      if (href == null || range == null) return;
      event.preventDefault();
      event.stopPropagation();
      quill.formatText(range.index, range.length, 'link', href, 'user');
    };
    quill.root.addEventListener('paste', onPaste, true);
    onCleanup(() => quill?.root.removeEventListener('paste', onPaste, true));
  });

  // Reseed the editor when `props.value` changes. The draft store keeps
  // `props.value` equal to the editor's own content while typing, so this is a
  // no-op then and never clobbers an in-progress edit; it only diverges after
  // Save/Remove (a button click, not active typing), where reseeding right away
  // is exactly what reflects the sanitized result or clears the box.
  createEffect(() => {
    const next = props.value;
    if (!quill || currentHtml() === next) return;
    setHtml(next);
  });

  onCleanup(() => {
    teardownResizer?.();
    // Quill 2 has no destroy(); dropping the ref lets it GC with its DOM node.
    quill = undefined;
  });

  return (
    <div class="signature-editor">
      <div ref={toolbarEl}>
        <span class="ql-formats">
          <Tooltip label="Font" as="span">
            <select class="ql-font" aria-label="Font">
              <For each={FONT_OPTIONS}>
                {(font) =>
                  font === false ? <option /> : <option value={font} />
                }
              </For>
            </select>
          </Tooltip>
          <Tooltip label="Size" as="span">
            <select class="ql-size" aria-label="Font size">
              <For each={SIZE_OPTIONS}>
                {(size) =>
                  size === false ? <option /> : <option value={size} />
                }
              </For>
            </select>
          </Tooltip>
        </span>
        <span class="ql-formats">
          <ToolbarButton format="bold" label="Bold" shortcut="cmd+b" />
          <ToolbarButton format="italic" label="Italic" shortcut="cmd+i" />
          <ToolbarButton
            format="underline"
            label="Underline"
            shortcut="cmd+u"
          />
        </span>
        <span class="ql-formats">
          <Tooltip label="Text color" as="span">
            <select class="ql-color" aria-label="Text color" />
          </Tooltip>
          <Tooltip label="Highlight color" as="span">
            <select class="ql-background" aria-label="Highlight color" />
          </Tooltip>
        </span>
        <span class="ql-formats">
          <ToolbarButton format="list" value="ordered" label="Numbered list" />
          <ToolbarButton format="list" value="bullet" label="Bulleted list" />
        </span>
        <span class="ql-formats">
          <ToolbarButton format="link" label="Link" />
          <ToolbarButton format="image" label="Image" />
        </span>
        <span class="ql-formats">
          <ToolbarButton format="clean" label="Clear formatting" />
        </span>
      </div>
      <div ref={editorEl} />
    </div>
  );
}
