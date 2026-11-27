WITH visible_team AS MATERIALIZED (
    SELECT 1 FROM team_user
    WHERE team_id = $3::uuid AND user_id = $4::text
), viewer_links AS MATERIALIZED (
    SELECT github_user_id, macro_id
    FROM github_links
    WHERE macro_id = $4::text AND github_user_id = ANY($1::text[])
      AND (($3::uuid IS NULL AND $2::text = $4::text)
           OR EXISTS (SELECT 1 FROM visible_team))
), matched_links AS MATERIALIZED (
    SELECT github_user_id, macro_id
    FROM github_links
    WHERE $3::uuid IS NOT NULL
      AND EXISTS (SELECT 1 FROM visible_team)
      AND github_user_id = ANY(ARRAY(
          SELECT requested.id FROM unnest($1::text[]) requested(id)
          WHERE NOT EXISTS (
              SELECT 1 FROM viewer_links viewer WHERE viewer.github_user_id = requested.id
          )
      ))
), linked_users AS MATERIALIZED (
    SELECT user_id, team_id
    FROM team_user
    WHERE user_id = ANY(ARRAY(SELECT DISTINCT macro_id FROM matched_links))
)
SELECT DISTINCT ON (scoped.github_user_id)
    scoped.github_user_id AS "github_user_id!", scoped.macro_id AS "macro_id!"
FROM (
    SELECT github_user_id, macro_id FROM viewer_links
    UNION ALL
    SELECT links.github_user_id, links.macro_id
    FROM matched_links links
    JOIN linked_users member ON member.user_id = links.macro_id
    WHERE member.team_id = $3::uuid
) scoped
ORDER BY scoped.github_user_id, (scoped.macro_id = $4::text) DESC, scoped.macro_id COLLATE "C"
