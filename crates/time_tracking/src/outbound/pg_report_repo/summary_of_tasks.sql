-- Sums of entries over a period: the whole period, each group of the first
-- grouping ($4), and when a second grouping ($5) is given, each group's split
-- by it and its totals across groups. The key columns of a grouping not asked
-- for are always null, so grouping by them changes nothing; GROUPING() tells
-- the sets apart. Trashed tasks are left out here: the access check keeps them.
--
-- Everyone's entries on the tasks ($1), through time_entry_task_date.
-- $1: task ids, $2 and $3: the period, $4: group by, $5: then by or null.
WITH keyed AS (
    SELECT
        e.task_id,
        e.minutes,
        CASE WHEN $4 = 'person' THEN e.user_id END AS group_user,
        CASE WHEN $4 = 'task' THEN e.task_id END AS group_task,
        CASE WHEN $4 = 'day' THEN e.entry_date END AS group_day,
        CASE WHEN $5 = 'person' THEN e.user_id END AS then_user,
        CASE WHEN $5 = 'task' THEN e.task_id END AS then_task,
        CASE WHEN $5 = 'day' THEN e.entry_date END AS then_day
    FROM time_entry e
    JOIN "Document" d ON d.id = e.task_id
    WHERE e.task_id = ANY($1::text[])
      AND e.entry_date BETWEEN $2 AND $3
      AND d."deletedAt" IS NULL
)
SELECT
    GROUPING(group_user, group_task, group_day) = 0 AS "in_group!",
    GROUPING(then_user, then_task, then_day) = 0 AS "in_then!",
    group_user,
    group_task,
    group_day,
    then_user,
    then_task,
    then_day,
    sum(minutes)::bigint AS "minutes!",
    count(DISTINCT task_id)::bigint AS "task_count!"
FROM keyed
GROUP BY GROUPING SETS (
    (),
    (group_user, group_task, group_day),
    (group_user, group_task, group_day, then_user, then_task, then_day),
    (then_user, then_task, then_day)
)
