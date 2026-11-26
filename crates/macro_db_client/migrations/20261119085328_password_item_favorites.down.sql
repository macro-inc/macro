SET LOCAL lock_timeout = '2s';
DROP TRIGGER password_item_clear_favorites ON password_item_entities;
DROP TRIGGER password_item_seed_favorite ON password_item_entities;
DROP FUNCTION password_item_clear_favorites();
DROP FUNCTION password_item_seed_favorite();
DROP TABLE password_item_favorites;
