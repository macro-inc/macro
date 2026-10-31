-- Fixture for the Focus repository (email crate, outbound/focus_pg), loaded
-- after email_focus: link f02 (other@elsewhere.example) is linked to the
-- owner@acme.example account, as a secondary inbox Soup lists for that owner.

SET session_replication_role = 'replica';

INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
VALUES ('macro|owner@acme.example', 'macro|other@elsewhere.example', '00000000-0000-0000-0000-000000000f02');

SET session_replication_role = 'origin';
