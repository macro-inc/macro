# Attached list identity

The Source checklist-controls plugin registers a transform on every ListNode.
It skips TaskListNode instances, constructs a concrete TaskListNode, applies the
old ordinary export with updateFromJSON, and replaces the old list while moving
its existing children. This applies to bullet, numbered and check lists at any
depth. The separate progress collector covers only direct-root check lists.

The native transform follows that sequence only for ViewAttached MarkdownSync
surfaces. Registry-only parsers, generic list importers, headless surfaces and
other presets retain their existing behavior. A cold parsed plain list stays
plain until a real dirty update admits the controls transform. Existing task
lists keep their keys on later updates.

The Source regression executes both the markdown-paste parser/live-import
boundary and the actual snippet replacement helper with the controls plugin.
Native controls pin the paste result, cold import, text and element selection,
list fields, stored NodeState, child identity, nested lists and scope guards.
The native ApplyRemote control establishes transform admission with transforms
enabled; it does not establish Source remote-writer persistence, echo or WAL
ordering.

In construction paths that install native code highlighting, register these
controls afterward, once in the shared surface builder, before Group A policy.
