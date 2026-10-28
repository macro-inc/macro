-- Extends entity_filter_tests.sql with one representative document for every
-- Documents-view membership class used by the server projection contract.

INSERT INTO public.macro_user (id, username, email, stripe_customer_id)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'phase0other',
    'phase0-other@example.com',
    'stripe_mu_phase0_other'
)
ON CONFLICT DO NOTHING;

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES (
    'macro|phase0-other@example.com',
    'phase0-other@example.com',
    'stripe_phase0_other',
    1,
    '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT DO NOTHING;

-- doc-in-D remains visible to user-1 through entity_access, but is owned by a
-- different user so it represents an ordinary shared document.
UPDATE public."Document"
SET owner = 'macro|phase0-other@example.com'
WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- The standalone document represents a snippet with no email relation.
INSERT INTO public.document_sub_type (document_id, sub_type)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'snippet');

-- The isolated document already has a null subtype and no document_email row.
-- Give user-1 direct access so it represents an ordinary owned document.
INSERT INTO public.entity_access (
    entity_id,
    entity_type,
    source_id,
    source_type,
    access_level,
    granted_from_project_id
)
VALUES (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'document',
    'macro|user-1@test.com',
    'user',
    'view',
    NULL
);
