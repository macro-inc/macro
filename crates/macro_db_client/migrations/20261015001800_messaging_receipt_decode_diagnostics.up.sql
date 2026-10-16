-- Preserve decode diagnostics independently of transient processing outcomes.
ALTER TABLE meta_messaging_receipt
    ADD COLUMN decode_failures integer NOT NULL DEFAULT 0 CHECK (decode_failures >= 0);
