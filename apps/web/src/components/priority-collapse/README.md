# Priority collapse

`createPriorityCollapser.ts` owns the headless priority policy and
`useRegisterPriorityCollapseItem`. `PriorityCollapseOverflowSensor.tsx` adapts
row, viewport, and content measurements to that policy. Each row owns its
controller and connects its row element with `setRow`; callers register items
with its collapser. Split-layout registration wrappers remain in split-layout.

The sensor's last-resort title cap sets `reclaimSpaceOnExpand` so new or resumed
items give up space before the title stays truncated. Ordinary controls never
collapse other controls during a failed expansion trial. Keep failed trials
silent and retry them only after measurements or registrations change.
