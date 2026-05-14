-- We are setting it so all team users have **opus** tier
-- First we will remove the existing tier roles from all users in teams
 DELETE FROM public."RolesOnUsers" rou
   USING public.team_user tu
   WHERE rou."userId" = tu.user_id
     AND rou."roleId" IN ('sub_opus', 'sub_haiku', 'sub_sonnet');

-- Then we will insert the sub_opus role for all the users
   INSERT INTO public."RolesOnUsers" ("userId", "roleId")
   SELECT DISTINCT tu.user_id, 'sub_opus'
   FROM public.team_user tu
   ON CONFLICT ("userId", "roleId") DO NOTHING;
