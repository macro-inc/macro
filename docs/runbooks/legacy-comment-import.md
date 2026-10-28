# Legacy comment import (retired)

The document and CRM importers are retired by this schema-drop PR. Their imports
and the earlier #6732 contract deployment completed before this change. The final
PDF query fix ships together with the drop, so old instances may fail to attach
highlight discussions between the migration and successful service replacement.
Their source tables no longer exist after the migration. Do not run an importer from an older checkout against a
post-drop database.

See [the schema-drop release instructions](comment-schema-drop.md) for deployment
evidence, prerequisites, validation, and recovery. Historical importer code and
its operating guide remain available in Git history before this change.

The `migrated_comment_id` and `migrated_comment_thread_id` tables remain in use:
old numeric document comment/thread links resolve through those mappings.
