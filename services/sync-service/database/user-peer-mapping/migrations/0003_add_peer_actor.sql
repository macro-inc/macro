-- The signed agent actor (e.g. `bot|<uuid>`) a peer edited as, NULL for humans.
ALTER TABLE peer_user_map ADD COLUMN actor TEXT;
