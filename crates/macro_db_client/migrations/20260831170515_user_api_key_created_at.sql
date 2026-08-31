-- Persist creation time and return it from the list endpoint.
ALTER TABLE "UserApiKey"
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
