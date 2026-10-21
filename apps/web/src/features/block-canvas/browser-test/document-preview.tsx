export function DocumentPreviewContent() {
  return (
    <button
      type="button"
      data-testid="canvas-reference"
      onClick={() => {
        window.canvasFixture.opens++;
      }}
    >
      Referenced document
    </button>
  );
}

export const PopupPreview = DocumentPreviewContent;
export const getMentionsIcon = () => undefined;
export const mentionsAccessories = () => undefined;
