-- Deployment prerequisite: check the production row count with
-- `SELECT count(*) FROM "SharePermission";` before applying this migration.
-- If the table has more than approximately 10 million rows, replace this
-- single-statement backfill with a batched migration.
ALTER TABLE "SharePermission"
    ADD COLUMN "linkShare" TEXT,
    ADD COLUMN "linkShareAccessLevel" "AccessLevel",
    ADD CONSTRAINT "SharePermission_linkShare_check"
        CHECK ("linkShare" IN ('PUBLIC', 'TEAM')),
    ADD CONSTRAINT "SharePermission_linkShareAccessLevel_check"
        CHECK ("linkShare" IS NOT NULL OR "linkShareAccessLevel" IS NULL),
    ALTER COLUMN "isPublic" SET DEFAULT false;

UPDATE "SharePermission"
SET "linkShare" = CASE WHEN "isPublic" THEN 'PUBLIC' END,
    "linkShareAccessLevel" = CASE
        WHEN "isPublic" THEN "publicAccessLevel"::"AccessLevel"
    END;

