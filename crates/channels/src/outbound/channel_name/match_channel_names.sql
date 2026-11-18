-- Start from the viewer's own memberships and look everything else up by key,
-- so the work is bounded by the channels the viewer is in. The OFFSET 0 fences
-- keep that shape under a generic plan, which estimates every viewer at the
-- table's average of a few memberships: the previous statement joined its
-- matched terms back to the viewer's channels in a nested loop there, channels
-- times matches, seconds for a viewer in a few thousand channels.
--
-- Channels are sorted before their names are resolved, so the LIMIT stops the
-- participant lookups once a page has matched.
SELECT c.id AS "id!", c.updated_at AS "updated_at!"
FROM (
    SELECT c.id, c.name, c.channel_type, c.updated_at
    FROM (
        SELECT me.channel_id
        FROM comms_channel_participants me
        WHERE me.user_id = $1
            AND me.left_at IS NULL
        OFFSET 0
    ) mine
    CROSS JOIN LATERAL (
        SELECT c.id, c.name, c.channel_type, c.updated_at
        FROM comms_channels c
        WHERE c.id = mine.channel_id
            AND (cardinality($2::uuid[]) = 0 OR c.id = ANY($2::uuid[]))
            AND (cardinality($3::text[]) = 0 OR c.channel_type::text = ANY($3::text[]))
            AND (
                $4::timestamptz IS NULL
                OR (c.updated_at, c.id) < ($4::timestamptz, $5::uuid)
            )
        OFFSET 0
    ) c
    ORDER BY c.updated_at DESC, c.id DESC
    OFFSET 0
) c
CROSS JOIN LATERAL (
    -- The other active participants' names, only for the channels named after
    -- them: each person by id, each bot from the registry or by primary key.
    SELECT array_agg(
        CASE
            WHEN other.user_id LIKE 'bot|%' THEN COALESCE(
                (
                    SELECT system_bot.name
                    FROM unnest($8::uuid[], $9::text[]) AS system_bot(id, name)
                    WHERE other.user_id = 'bot|' || system_bot.id::text
                    LIMIT 1
                ),
                (
                    -- Only a canonical id can equal 'bot|' || bots.id::text.
                    SELECT bot.name
                    FROM bots bot
                    WHERE bot.id = CASE
                            WHEN substr(other.user_id, 5)
                                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN substr(other.user_id, 5)::uuid
                        END
                        AND bot.deleted_at IS NULL
                ),
                'Bot'
            )
            ELSE COALESCE(
                (
                    SELECT NULLIF(
                        concat_ws(
                            ' ',
                            NULLIF(mui.first_name, 'N/A'),
                            NULLIF(mui.last_name, 'N/A')
                        ),
                        ''
                    )
                    FROM "User" u
                    JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
                    WHERE u.id = other.user_id
                ),
                split_part(split_part(other.user_id, '|', 2), '@', 1)
            )
        END
    ) AS names
    FROM comms_channel_participants other
    WHERE other.channel_id = c.id
        AND other.left_at IS NULL
        AND other.user_id <> $1
        AND (
            c.channel_type = 'direct_message'
            OR (c.channel_type = 'private' AND NULLIF(BTRIM(c.name), '') IS NULL)
        )
) people
WHERE cardinality($6::text[]) > 0
    AND NOT EXISTS (
        SELECT 1
        FROM unnest($6::text[]) AS p(pattern)
        WHERE NOT COALESCE(
            (
                NULLIF(BTRIM(c.name), '') IS NOT NULL
                AND CASE
                    WHEN $7::bool THEN c.name ~* p.pattern
                    ELSE c.name ILIKE p.pattern
                END
            )
            OR EXISTS (
                SELECT 1
                FROM unnest(people.names) AS person(name)
                WHERE CASE
                    WHEN $7::bool THEN person.name ~* p.pattern
                    ELSE person.name ILIKE p.pattern
                END
            ),
            false
        )
    )
ORDER BY c.updated_at DESC, c.id DESC
LIMIT $10
