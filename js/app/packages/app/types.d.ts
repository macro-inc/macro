declare module '*.svg' {
  import type { Component, ComponentProps } from 'solid-js';
  const c: Component<ComponentProps<'svg'>>;
  export default c;
}

// Extend JSX types to allow 'sound' attribute on HTML elements
declare module 'solid-js' {
  namespace JSX {
    interface HTMLAttributes<T> {
      sound?: string;
    }
  }
}
