-- Per-member seat plans.
--
-- A paying team may mix Premium ($40) and Max ($200) seats: each member's
-- plan is recorded on their membership row, the team's Stripe subscription
-- carries one seat item per plan (quantity = members on that plan), and the
-- team's pooled AI allowance is the sum of every seat's allowance.

CREATE TYPE "seat_plan" AS ENUM ('premium', 'max');

ALTER TABLE "team_user"
    ADD COLUMN "plan" "seat_plan" NOT NULL DEFAULT 'premium';

-- Before this change the owner's subscription price set the plan for the whole
-- team, and the webhook recorded it as `sub_max` on the owner. Carry that
-- over: a team whose owner holds `sub_max` was a Max team, so every seat was
-- billed at the Max price.
UPDATE "team_user" tu
   SET "plan" = 'max'
  FROM "team" t
  JOIN "RolesOnUsers" rou ON rou."userId" = t.owner_id AND rou."roleId" = 'sub_max'
 WHERE tu.team_id = t.id;

-- Members now carry their own tier role (sub_opus or sub_max) so the AI
-- allowance and the paid-model permission follow the seat, not the owner.
INSERT INTO "RolesOnUsers" ("userId", "roleId")
SELECT tu.user_id, 'sub_max'
  FROM "team_user" tu
 WHERE tu."plan" = 'max'
ON CONFLICT ("userId", "roleId") DO NOTHING;

DELETE FROM "RolesOnUsers" rou
 USING "team_user" tu
 WHERE rou."userId" = tu.user_id
   AND tu."plan" = 'max'
   AND rou."roleId" = 'sub_opus';
