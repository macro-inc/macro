-- Fence the primary-key lookup before applying guards: stale statistics can
-- otherwise favor a partial team index and scan every item in the team.
WITH target AS MATERIALIZED (
    SELECT team_id,id FROM password_item_entities WHERE team_id=$1 AND id=$2
)
UPDATE password_item_entities item
SET metadata=$3,version=$4,grants=$5,deleting=$7,revision=item.revision+1,totp_key_id=$8,
    cleanup_due_at=CASE WHEN $7 THEN COALESCE(item.cleanup_due_at,now()+interval '180 seconds') ELSE item.cleanup_due_at END
FROM target
WHERE item.team_id=target.team_id AND item.id=target.id AND item.version=$6 AND item.revision=$9 AND item.deleted_at IS NULL
