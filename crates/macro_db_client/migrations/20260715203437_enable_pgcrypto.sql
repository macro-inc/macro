-- pgcrypto's digest() is IMMUTABLE, so it can back expression indexes
-- (the built-in sha256() needs a text->bytea conversion, and convert_to()
-- is only STABLE).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
