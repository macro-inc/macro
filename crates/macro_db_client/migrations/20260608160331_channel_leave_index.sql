-- no-transaction

 CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_cp_active_by_user_channel
      ON comms_channel_participants (user_id, channel_id)
      WHERE left_at IS NULL;
