-- A form's branding: the static files shown as its logo and cover image,
-- and the color of its buttons and selections. Unset means Macro's default.
ALTER TABLE forms
    ADD COLUMN logo_file_id UUID,
    ADD COLUMN cover_file_id UUID,
    ADD COLUMN accent_color TEXT CHECK (accent_color ~ '^#[0-9a-f]{6}$');
