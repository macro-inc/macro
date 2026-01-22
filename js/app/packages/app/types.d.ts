declare module '*.svg' {
  import type { Component, ComponentProps } from 'solid-js';
  const c: Component<ComponentProps<'svg'>>;
  export default c;
}
