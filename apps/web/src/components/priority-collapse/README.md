# Priority collapse

`createPriorityCollapser.ts` owns the headless priority policy and
`useRegisterPriorityCollapseItem`. `PriorityCollapseOverflowSensor.tsx` adapts
row, viewport, and content measurements to that policy. Each row owns its
controller and connects its row element with `setRow`; callers register items
with its collapser. Split-layout registration wrappers remain in split-layout.
