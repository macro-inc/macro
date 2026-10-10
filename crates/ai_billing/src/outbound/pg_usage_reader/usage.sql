WITH history AS MATERIALIZED (
    SELECT user_id, changed_at, previous_plan, new_plan,
           previous_included_cost_cents, new_included_cost_cents
    FROM ai_billing_plan_change
    WHERE user_id = ANY($1) AND period_start = $2 AND changed_at < $3
), boundaries AS (
    SELECT requested.user_id, $2::timestamptz AS start
    FROM UNNEST($1::text[]) AS requested(user_id)
    UNION
    SELECT user_id, changed_at FROM history
), intervals AS (
    SELECT user_id, start,
           LEAD(start, 1, $3) OVER (PARTITION BY user_id ORDER BY start) AS end
    FROM boundaries
), usage_segments AS (
    SELECT interval.user_id, interval.start,
           COALESCE(SUM(COALESCE(
               usage.total::float8,
               usage.input_tokens::float8 / 1000000.0 * $4
                   + usage.output_tokens::float8 / 1000000.0 * $5
                   + usage.cache_read_input_tokens::float8 / 1000000.0 * $6
                   + usage.cache_write_input_tokens::float8 / 1000000.0 * $7
           )), 0)::float8 AS usd,
           EXISTS (
               SELECT 1 FROM ai_billing_usage_period AS policy
               WHERE policy.user_id = interval.user_id AND policy.period_start = $2
                 AND policy.policy = 'public_allowance_v1'
           ) AS public_funding
    FROM intervals AS interval
    LEFT JOIN ai_usage AS usage
        ON usage.user_id = interval.user_id
       AND usage.created_at >= interval.start AND usage.created_at < interval.end
       AND usage.count_usage = TRUE
    GROUP BY interval.user_id, interval.start
)
SELECT TRUE AS "is_plan_change!", user_id AS "user_id!", changed_at AS "start!",
       previous_plan AS "previous_plan?", new_plan AS "new_plan?",
       previous_included_cost_cents, new_included_cost_cents,
       NULL::float8 AS "usd?", NULL::boolean AS "public_funding?"
FROM history
UNION ALL
SELECT FALSE, user_id, start, NULL::text, NULL::text,
       NULL::bigint, NULL::bigint, usd, public_funding
FROM usage_segments
ORDER BY "user_id!", "start!", "is_plan_change!" DESC, "previous_plan?", "new_plan?"
