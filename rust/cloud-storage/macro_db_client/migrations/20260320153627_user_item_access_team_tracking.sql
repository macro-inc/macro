ALTER TABLE "UserItemAccess" ADD COLUMN "granted_from_team_id" UUID
    REFERENCES "team" ("id") ON DELETE CASCADE;

-- Fast lookups for all items shared to your team
CREATE INDEX "UserItemAccess_granted_from_team_id_idx" ON "UserItemAccess" ("granted_from_team_id");

-- Cannot share an item more than once through your team
CREATE UNIQUE INDEX "UserItemAccess_user_id_item_id_item_type_granted_from_team_key" ON "UserItemAccess" ("user_id", "item_id", "item_type", "granted_from_team_id");
