-- Deployment prerequisite: check the number of public rows with
-- `SELECT count(*) FROM "SharePermission" WHERE "isPublic";` before applying
-- this migration. If there are more than approximately 10 million public rows,
-- replace this single-statement backfill with a batched migration.
ALTER TABLE "SharePermission"
    ADD COLUMN "linkShare" TEXT,
    ADD COLUMN "linkShareAccessLevel" "AccessLevel",
    ADD CONSTRAINT "SharePermission_linkShare_check"
        CHECK ("linkShare" IN ('PUBLIC', 'TEAM')),
    ADD CONSTRAINT "SharePermission_linkShareAccessLevel_check"
        CHECK ("linkShare" IS NOT NULL OR "linkShareAccessLevel" IS NULL),
    ALTER COLUMN "isPublic" SET DEFAULT false;

UPDATE "SharePermission"
SET "linkShare" = 'PUBLIC',
    "linkShareAccessLevel" = COALESCE(
        "publicAccessLevel"::"AccessLevel",
        'view'::"AccessLevel"
    )
WHERE "isPublic";

