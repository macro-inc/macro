# Priority collapse

`createPriorityCollapser.ts` owns the headless priority policy and
`useRegisterPriorityCollapseItem`. `PriorityCollapseOverflowSensor.tsx` adapts
row, viewport, and content measurements to that policy. Each row owns its
controller and connects its row element with `setRow`; callers register items
with its collapser. Split-layout registration wrappers remain in split-layout.

When items register or resume after editing, reclaim space from lower-priority
items before retaining a higher-priority collapse such as title truncation.
Keep failed expansion trials silent and retry them only after measurements or
registrations change.
