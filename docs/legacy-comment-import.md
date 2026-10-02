# Legacy comment import (retired)

The document and CRM importers were retired with the schema-drop PR after the
imports and contract deployment completed. Their source tables no longer exist
after that migration. Do not run an importer from an older checkout against a
post-drop database.

See [the schema-drop release instructions](comment-schema-drop.md) for deployment
evidence, prerequisites, validation, and recovery. Historical importer code and
its operating guide remain available in Git history before this change.

The `migrated_comment_id` and `migrated_comment_thread_id` tables remain in use:
old numeric document comment/thread links resolve through those mappings.
