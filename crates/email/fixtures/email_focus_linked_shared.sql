-- Fixture for the Focus repository (email crate, outbound/focus_pg), loaded
-- after email_focus and email_focus_linked: link f02 is a mailbox several
-- people read. A second user (assistant@acme.example) reads it too, the owner
-- reaches it through a second edge, and one edge names the inbox's own owner
-- as its primary, as an edge left behind by a rehome can.

SET session_replication_role = 'replica';

INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
VALUES
    ('macro|assistant@acme.example', 'macro|other@elsewhere.example', '00000000-0000-0000-0000-000000000f02'),
    ('macro|owner@acme.example', 'macro|shared@acme.example', '00000000-0000-0000-0000-000000000f02'),
    ('macro|other@elsewhere.example', 'macro|shared@acme.example', '00000000-0000-0000-0000-000000000f02');

SET session_replication_role = 'origin';
