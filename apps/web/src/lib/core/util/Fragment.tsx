import { children, onMount, type ParentComponent, type Ref } from 'solid-js';

/**
 * Wrapper that passes resolved children inside JSX Fragment
 * Sets ref to node from resolved children
 *
 * DO NOT USE unless you need a dom reference from a third party Component that doesn't expose `ref`
 */
const Fragment: ParentComponent<{ ref: Ref<HTMLElement> }> = (props) => {
  const resolved = children(() => props.children);

  onMount(() => {
    const cb = props.ref as (el: HTMLElement) => void;
    cb(resolved() as HTMLElement);
  });

  return <>{resolved()}</>;
};

export default Fragment;
