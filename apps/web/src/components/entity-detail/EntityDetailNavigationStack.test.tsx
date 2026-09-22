import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EntityDetailNavigationStack,
  type EntityDetailNavigationStackRootProps,
  type EntityDetailTarget,
  useEntityDetailNavigationStack,
} from './EntityDetailNavigationStack';

const touch = vi.hoisted(() => ({ value: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () => () => true,
}));

const target: EntityDetailTarget = { type: 'email', id: 'thread' };
const click = (init: MouseEventInit) => ({
  event: new MouseEvent('click', init),
});

function mount(props: EntityDetailNavigationStackRootProps = {}) {
  let stack!: ReturnType<typeof useEntityDetailNavigationStack>;
  function Capture() {
    stack = useEntityDetailNavigationStack();
    return null;
  }
  const view = render(() => (
    <EntityDetailNavigationStack.Root {...props}>
      <Capture />
    </EntityDetailNavigationStack.Root>
  ));
  return { stack, ...view };
}

beforeEach(() => {
  touch.value = false;
});
afterEach(cleanup);

it('opens inline for plain activation and defers modifier clicks to a split', () => {
  const { stack } = mount();

  expect(stack.shouldNavigate(target)).toBe(true);
  expect(stack.shouldNavigate(target, click({}))).toBe(true);
  expect(stack.shouldNavigate(target, click({ shiftKey: true }))).toBe(false);
  expect(stack.shouldNavigate(target, click({ metaKey: true }))).toBe(false);
  expect(stack.shouldNavigate(target, click({ ctrlKey: true }))).toBe(false);
  expect(stack.navigate(target, click({ altKey: true }))).toBe(false);
  expect(stack.entries).toHaveLength(0);
});

it('never opens inline on touch layouts', () => {
  touch.value = true;
  const { stack } = mount();

  expect(stack.shouldNavigate(target)).toBe(false);
  expect(stack.navigate(target)).toBe(false);
  expect(stack.entries).toHaveLength(0);
});

it('lets a view replace the default policy', () => {
  touch.value = true;
  const { stack } = mount({ shouldNavigate: () => true });

  expect(stack.shouldNavigate(target, click({ shiftKey: true }))).toBe(true);
  expect(stack.navigate(target)).toBe(true);
  expect(stack.entries).toHaveLength(1);
});
