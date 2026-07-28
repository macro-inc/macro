-- Account creation time, used to gate new-user features (e.g. the Getting
-- Started checklist) to accounts created after a cutoff date. Existing rows
-- deliberately stay NULL — they were created before tracking began, and an
-- eager column default would stamp every legacy account with the migration
-- time, making old accounts look brand new. The default is added separately
-- so only rows inserted from now on get a timestamp.
ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMPTZ;
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
