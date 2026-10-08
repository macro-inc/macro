type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function screenPointForInput(
  hierarchy: string,
  packageName: string,
  input: { rect: Bounds; viewport: Bounds }
): { x: number; y: number };

export function testShareTokens(
  files: {
    token: string;
    name?: string;
    isSharedText?: boolean;
    sharedText?: string;
  }[],
  fixture: { imageName: string; sharedText: string }
): string[];
