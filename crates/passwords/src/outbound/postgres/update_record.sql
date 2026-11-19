-- Lock the row by primary key and update it by ctid: with stale statistics a
-- join back on (team_id,id) can still reach the target through the partial
-- team search index and filter every item in the team. A Tid Scan cannot.
-- FOR UPDATE returns the row's latest version, so the guards below always
-- judge current data. Unlike a plain UPDATE, a row changed concurrently after
-- this statement's snapshot is not re-checked and updates nothing (Conflict):
-- every writer of a live item must bump revision, which fails the guard anyway.
WITH target AS MATERIALIZED (
    SELECT ctid FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR UPDATE
)
UPDATE password_item_entities item
SET metadata=$3,version=$4,grants=$5,deleting=$7,revision=item.revision+1,totp_key_id=$8,
    cleanup_due_at=CASE WHEN $7 THEN COALESCE(item.cleanup_due_at,now()+interval '180 seconds') ELSE item.cleanup_due_at END
FROM target
WHERE item.ctid=target.ctid AND item.version=$6 AND item.revision=$9 AND item.deleted_at IS NULL
