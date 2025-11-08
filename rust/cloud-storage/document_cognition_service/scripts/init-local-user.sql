/* LOCAL DEVELOPMENT USER SETUP TEMPLATE */
/* Add the local development user */
INSERT INTO
    public."User" ("id", "email", "stripeCustomerId")
VALUES
    (
        'USER_ID_PLACEHOLDER',
        'EMAIL_PLACEHOLDER',
        'STRIPE_ID_PLACEHOLDER'
    ) ON CONFLICT ("id") DO NOTHING;

/* Give the user AI subscriber role for chat functionality */
INSERT INTO
    public."RolesOnUsers" ("roleId", "userId")
VALUES
    ('ai_subscriber', 'USER_ID_PLACEHOLDER') ON CONFLICT ("roleId", "userId") DO NOTHING;

/* Give the user professional subscriber role for advanced features */
INSERT INTO
    public."RolesOnUsers" ("roleId", "userId")
VALUES
    ('professional_subscriber', 'USER_ID_PLACEHOLDER') ON CONFLICT ("roleId", "userId") DO NOTHING;

/* Give the user self serve role for subscription management */
INSERT INTO
    public."RolesOnUsers" ("roleId", "userId")
VALUES
    ('self_serve', 'USER_ID_PLACEHOLDER') ON CONFLICT ("roleId", "userId") DO NOTHING;

/* Give the user editor role */
INSERT INTO
    public."RolesOnUsers" ("roleId", "userId")
VALUES
    ('editor_user', 'USER_ID_PLACEHOLDER') ON CONFLICT ("roleId", "userId") DO NOTHING;