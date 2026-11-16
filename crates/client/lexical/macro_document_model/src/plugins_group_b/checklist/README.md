# Attached list identity

The web editor's checklist-controls plugin transforms every non-task ListNode
into a TaskListNode (via `updateFromJSON` of the old export) and moves its
children, for bullet, numbered and check lists at any depth. The progress
collector covers only direct-root check lists.

The native transform does the same only on ViewAttached MarkdownSync surfaces.
Registry-only parsers, generic importers, headless surfaces and other presets are
unchanged, and a cold-parsed plain list stays plain until a dirty update runs the
transform. Existing task lists keep their keys.

Register these controls once in the shared surface builder, after native code
highlighting and before Group A policy.
