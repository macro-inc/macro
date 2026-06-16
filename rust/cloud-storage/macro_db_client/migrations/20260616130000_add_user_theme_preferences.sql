-- Per-user light/dark theme preferences. Mirrors the frontend defaults
-- (DEFAULT_LIGHT_THEME / DEFAULT_DARK_THEME in js/app/packages/theme/constants.ts).
-- Theme ids are free-form strings: default themes use their name as id, user
-- themes use UUIDs, so TEXT is correct here.
ALTER TABLE "User"
    ADD COLUMN "preferredLightTheme" TEXT    NOT NULL DEFAULT 'Macro Light',
    ADD COLUMN "preferredDarkTheme"  TEXT    NOT NULL DEFAULT 'Macro Dark',
    ADD COLUMN "themeMatchesSystem"  BOOLEAN NOT NULL DEFAULT true;
