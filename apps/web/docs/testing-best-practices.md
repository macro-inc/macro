# Testing Best Practices: SolidJS & TanStack Query

## Core Principles

1. **Test features, not implementations** - Tests should verify behavior users care about, not internal details
2. **Isolate each test** - Fresh QueryClient per test, no shared state between tests
3. **Disable retries** - Prevent timeouts and make tests deterministic
4. **Avoid `waitFor` when possible** - Solid's signals update synchronously; only use for async operations like router navigation or suspense

## Setup

### Dependencies

```bash
npm i vitest jsdom @solidjs/testing-library @testing-library/user-event @testing-library/jest-dom -D
```

### Vitest Configuration

```typescript
// vitest.config.ts
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

## TanStack Query Testing

### QueryClient Configuration

Always create a fresh QueryClient per test with retries disabled:

```typescript
let testQueryClient: QueryClient;

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
});

afterEach(() => {
  testQueryClient.clear();
});
```

### Wrapper Pattern

Create a reusable wrapper for components that need QueryClient context:

```typescript
function createWrapper() {
  return function Wrapper(props: { children: JSX.Element }) {
    return (
      <QueryClientProvider client={testQueryClient}>
        {props.children}
      </QueryClientProvider>
    );
  };
}

function renderWithClient(Component: () => JSX.Element): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Wrapper = createWrapper();
  const dispose = render(
    () => (
      <Wrapper>
        <Component />
      </Wrapper>
    ),
    container
  );
  return () => {
    dispose();
    container.remove();
  };
}
```

### Testing Mutations

Test mutations by rendering a component that uses the mutation hook:

```typescript
it('should update cache optimistically', async () => {
  // Seed cache with initial data
  seedQueryCache([createMockPage([item1, item2])]);

  // Mock service response
  mockServiceMethod.mockResolvedValue(ok({ success: true }));

  let mutatePromise: Promise<unknown> | undefined;

  const TestComponent = () => {
    const mutation = useMyMutation();
    mutatePromise = mutation.mutateAsync({ id: 'item1' });
    return null;
  };

  const cleanup = renderWithClient(TestComponent);
  await mutatePromise;

  // Assert cache was updated
  const items = getItemsFromCache();
  expect(items).toHaveLength(1);

  cleanup();
});
```

### Testing Rollback on Error

```typescript
it('should rollback on error', async () => {
  seedQueryCache([createMockPage([item1])]);

  mockServiceMethod.mockResolvedValue(err('SERVER_ERROR', 'Failed'));

  let mutatePromise: Promise<unknown> | undefined;

  const TestComponent = () => {
    const mutation = useMyMutation();
    mutatePromise = mutation.mutateAsync({ id: 'item1' }).catch(() => {});
    return null;
  };

  const cleanup = renderWithClient(TestComponent);
  await mutatePromise;
  await new Promise((r) => setTimeout(r, 10)); // Wait for rollback

  // Assert cache was restored
  const items = getItemsFromCache();
  expect(items).toHaveLength(1);

  cleanup();
});
```

## SolidJS Testing

### Component Testing

```typescript
import { render } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';

test('button increments counter', async () => {
  const { getByRole } = render(() => <Counter />);
  const button = getByRole('button');

  expect(button).toHaveTextContent('0');
  await userEvent.setup().click(button);
  expect(button).toHaveTextContent('1');
});
```

### Testing Hooks with renderHook

For hooks that don't need DOM:

```typescript
import { renderHook } from '@solidjs/testing-library';

test('hook returns initial state', () => {
  const { result } = renderHook(useMyHook);
  expect(result.value).toBe(0);

  result.increment();
  expect(result.value).toBe(1);
});
```

### Testing Effects with testEffect

For async reactive effects:

```typescript
import { testEffect } from '@solidjs/testing-library';

test('effect reacts to signal changes', () => {
  const [value, setValue] = createSignal(0);

  return testEffect((done) =>
    createEffect((run = 0) => {
      if (run === 0) {
        expect(value()).toBe(0);
        setValue(1);
      } else {
        expect(value()).toBe(1);
        done();
      }
      return run + 1;
    })
  );
});
```

### Query Selectors (Priority Order)

Use accessibility-first selectors:

1. `getByRole` - WAI-ARIA roles (preferred)
2. `getByLabelText` - Form labels
3. `getByPlaceholderText` - Placeholders
4. `getByText` - Text content
5. `getByTestId` - Last resort

### Context Wrappers

```typescript
const wrapper = (props) => (
  <MyContext.Provider value={mockValue} {...props} />
);

const { getByText } = render(() => <Consumer />, { wrapper });
```

## What NOT to Test

- Query key structure (implementation detail)
- That service clients are called with exact params (if behavior test passes, this is proven)
- Empty array edge cases (unless it's a user-facing feature)
- Internal function calls between modules

## What TO Test

- Optimistic updates modify cache correctly
- Rollback restores previous state on error
- Multi-page/paginated data is handled correctly
- Error states propagate to callers
- User-visible behavior changes

## Mocking Service Clients

Mock at the module boundary, not internal functions:

```typescript
vi.mock('@service/client', () => ({
  serviceClient: {
    fetchData: vi.fn(),
    updateData: vi.fn(),
  },
}));

import { serviceClient } from '@service/client';

const mockFetchData = vi.mocked(serviceClient.fetchData);
const mockUpdateData = vi.mocked(serviceClient.updateData);
```

## References

- [SolidJS Testing Guide](https://docs.solidjs.com/guides/testing)
- [Solid Testing Library](https://github.com/solidjs/solid-testing-library)
- [TanStack Query Testing](https://tanstack.com/query/v5/docs/framework/react/guides/testing)
- [TanStack Query Optimistic Updates](https://tanstack.com/query/v5/docs/react/guides/optimistic-updates)
- [Testing Library Intro](https://testing-library.com/docs/solid-testing-library/intro/)
