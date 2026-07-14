ALTER TABLE "team_user" ADD CONSTRAINT "team_user_user_id_unique" UNIQUE ("user_id");

ALTER TABLE "team" ADD CONSTRAINT "team_owner_id_unique" UNIQUE ("owner_id");
