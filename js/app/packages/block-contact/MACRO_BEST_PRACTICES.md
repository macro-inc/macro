# Macro's SolidJS Best Practices vs Standard React Patterns

This document outlines the key differences between Macro's idiomatic SolidJS code patterns and typical React "midtier coder slop".

## Key Principles

### 1. **Signal/Store Management**

**✅ Macro Way (SolidJS)**
```typescript
// Single source of truth with typed signals
export const blockDataSignal = blockDataSignalAs<ContactData>('contact');

// Clean signal exports 
export const emailPreviewsSignal = createBlockSignal<ThreadPreview[]>([]);

// Direct getter access
const emailPreviews = emailPreviewsSignal.get;
```

**❌ React Slop**
```typescript
// Multiple useState scattered around
const [emailPreviews, setEmailPreviews] = useState<ThreadPreview[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

// Props drilling everywhere
<ChildComponent emailPreviews={emailPreviews} setEmailPreviews={setEmailPreviews} />
```

### 2. **Component Structure**

**✅ Macro Way**
```typescript
// Default export for main blocks
export default function BlockContact() {
  const blockData = blockDataSignal.get;
  // Direct signal access, no props needed
}

// Simple function components for internals
function EmailPreviewItem(props: { preview: ThreadPreview }) {
  // Minimal props, only what's needed
}
```

**❌ React Slop**
```typescript
// Named exports everywhere
export const BlockContact: React.FC<BlockContactProps> = ({ 
  data, 
  onUpdate, 
  isLoading,
  // ... 20 more props
}) => {
  // Component bloated with prop handling
}
```

### 3. **Effects & Lifecycle**

**✅ Macro Way**
```typescript
// Clear separation of concerns
onMount(() => {
  initializeData();
});

createEffect(() => {
  const data = blockData();
  if (!data) return;
  // Reactive updates only
});
```

**❌ React Slop**
```typescript
// useEffect hell
useEffect(() => {
  // Everything mixed together
  fetchData();
  setupListeners();
  // Forgot cleanup
}, [dep1, dep2, dep3, dep4]);
```

### 4. **Store Patterns**

**✅ Macro Way**
```typescript
// Single typed store for related data
export const mdStore = createBlockStore<MdData>({});

// Direct access
mdStore.set({ editor: lexicalEditor });
```

**❌ React Slop**
```typescript
// Context wrapper hell
<EditorProvider>
  <ThemeProvider>
    <DataProvider>
      <YourComponent />
    </DataProvider>
  </ThemeProvider>
</EditorProvider>
```

### 5. **Component Composition**

**✅ Macro Way**
```typescript
// Clean, focused components
<Show when={emailPreviews().length > 0} fallback={<EmptyState />}>
  <VList data={emailPreviews()}>
    {(preview) => <EmailPreviewItem preview={preview} />}
  </VList>
</Show>
```

**❌ React Slop**
```typescript
// Ternary operator abuse
{isLoading ? (
  <Spinner />
) : error ? (
  <Error message={error} />
) : data.length > 0 ? (
  data.map(item => <Item key={item.id} {...item} />)
) : (
  <Empty />
)}
```

### 6. **Imports Organization**

**✅ Macro Way**
```typescript
// Type imports first
import type { ContactData } from '../definition';

// External deps
import { createSignal } from 'solid-js';

// Core imports
import { useBlockId } from '@core/block';

// Service imports  
import { emailClient } from '@service-email/client';

// Local imports
import { EmailPreviewList } from './EmailPreviewList';
```

**❌ React Slop**
```typescript
// Random order
import React from 'react';
import './styles.css';
import { useState } from 'react';
import type { Props } from './types';
import axios from 'axios';
```

## Applied Refactoring

The block-contact code has been refactored to follow these patterns:

1. **Signals**: Converted all React-style useState to createBlockSignal
2. **Component Structure**: Used default export for main block, simple functions for sub-components
3. **Direct Access**: Removed props drilling, components access signals directly
4. **Clean Effects**: Separated onMount logic from reactive createEffect
5. **Focused Components**: Each component has a single responsibility
6. **No Wrappers**: Removed unnecessary div wrappers and component nesting

## Benefits

- **Performance**: SolidJS's fine-grained reactivity > React's virtual DOM
- **Simplicity**: Direct signal access > props drilling
- **Type Safety**: Better TypeScript inference with signals
- **Readability**: Clear separation of concerns
- **Maintainability**: Less boilerplate, more focused code 