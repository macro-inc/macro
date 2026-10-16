-- Follow-up to the legacy-query cleanup: get_macro_share_permission had no
-- callers in current main or the deployed monorepo, and the old DCS /macros
-- routes are no longer deployed. Keep this schema change separate from the
-- service-only cleanup of that helper and its SQLx metadata.
-- Historical prompt data is intentionally discarded. SharePermission is shared
-- by active features and must remain, as must the organization/enterprise tables.
SET LOCAL lock_timeout = '5s';

-- MacroPromptAttachment was removed by the preceding migration. Preserve
-- PostgreSQL's default RESTRICT behavior for any other unexpected dependents.
DROP TABLE "MacroPromptPermission";
DROP TABLE "MacroPrompt";
