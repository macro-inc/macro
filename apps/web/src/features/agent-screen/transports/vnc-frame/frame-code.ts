/**
 * noVNC and the frame's own code, bundled into one string for the sandboxed
 * frame's inline module script (`scripts/sandboxed-frame-bundle.ts`). A
 * sizeable chunk: loaded only when a screen opens.
 */
export async function loadVncFrameCode(): Promise<string> {
  const { default: code } = await import(
    'virtual:sandboxed-frame/features/agent-screen/transports/vnc-frame/frame-main'
  );
  return code;
}
