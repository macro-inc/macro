-- Deployment prerequisite: check the production row count with
-- `SELECT count(*) FROM "SharePermission";` before applying this migration.
-- If the table has more than approximately 10 million rows, replace this
-- single-statement backfill with a batched migration.
ALTER TABLE "SharePermission"
    ADD COLUMN "linkShare" TEXT,
    ADD COLUMN "linkShareAccessLevel" TEXT,
    ADD CONSTRAINT "SharePermission_linkShare_check"
        CHECK ("linkShare" IN ('PUBLIC', 'TEAM')),
    ALTER COLUMN "isPublic" SET DEFAULT false;

UPDATE "SharePermission"
SET "linkShare" = CASE WHEN "isPublic" THEN 'PUBLIC' END,
    "linkShareAccessLevel" = "publicAccessLevel";

CREATE INDEX "SharePermission_linkShare_idx"
    ON "SharePermission" ("linkShare")
    WHERE "linkShare" IS NOT NULL;
