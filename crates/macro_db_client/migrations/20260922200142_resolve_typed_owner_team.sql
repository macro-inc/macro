-- Set-based implementation of model_owner::team::owner_team (Q10).
-- Keep this SQL function inlinable: user owners retain the indexed team_user
-- lookup, with no per-entity client round trips. Membership is unique by user_id.
-- This resolves a link audience only, never the principal allowed to edit shares.
CREATE FUNCTION public.owner_team(principal text)
RETURNS TABLE (team_id uuid)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT tu.team_id
    FROM public.team_user tu
    WHERE tu.user_id = principal
      -- Retain legacy user ids, but never treat a typed bot/team as a user.
      AND principal NOT LIKE 'bot|%'
      AND principal !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    UNION ALL
    SELECT CASE WHEN principal ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN principal::uuid END
    WHERE principal ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    UNION ALL
    SELECT COALESCE(b.team_id, tu.team_id)
    FROM public.bots b
    LEFT JOIN public.team_user tu ON b.team_id IS NULL AND tu.user_id = b.owner_user_id
    WHERE b.id = CASE WHEN principal ~ '^bot\|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                      THEN substring(principal FROM 5)::uuid END
      AND COALESCE(b.team_id, tu.team_id) IS NOT NULL
$$;
