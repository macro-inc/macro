declare module '*.svg' {
  import type { Component, ComponentProps } from 'solid-js';
  const c: Component<ComponentProps<'svg'>>;
  export default c;
}

declare module '@aws-crypto/sha256-js' {
  export class Sha256 {
    update(data: string | Uint8Array): void;
    digestSync(): Uint8Array;
  }
}
