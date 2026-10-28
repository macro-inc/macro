-- Booking is a final form step; the target is only revealed after acceptance.
ALTER TABLE form_sections DROP CONSTRAINT form_sections_kind_check;
ALTER TABLE form_sections ADD CONSTRAINT form_sections_kind_check
    CHECK (kind IN ('questions', 'gate', 'booking'));
ALTER TABLE form_sections ADD COLUMN booking_target JSONB;
ALTER TABLE form_sections ADD CONSTRAINT form_sections_booking_target_check CHECK (
    (kind = 'booking' AND booking_target IS NOT NULL AND jsonb_typeof(booking_target) = 'object')
    OR (kind <> 'booking' AND booking_target IS NULL)
);

-- Once enabled, the Loro draft is the layout's only writer. The section and
-- question rows are its validated projection used by respondents.
ALTER TABLE forms ADD COLUMN layout_draft_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forms ADD COLUMN layout_revision BYTEA;
