-- Scope delegation edges to a single inbox: link_id pins each edge to one email_links
-- row, replacing the account-wide grant over every link under child (including links
-- created after the edge).
ALTER TABLE macro_user_links
    ADD COLUMN link_id UUID REFERENCES email_links(id) ON DELETE CASCADE;

ALTER TABLE macro_user_links DROP CONSTRAINT macro_user_links_pkey;

-- Pin pre-existing account-wide edges to the links the child owns right now, so a
-- delegate keeps exactly what they can already see but gains nothing connected later.
-- An account-wide edge whose child has no links grants nothing and is simply dropped.
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT mul.primary_macro_id, mul.child_macro_id, el.id
FROM macro_user_links mul
JOIN email_links el ON el.macro_id = mul.child_macro_id
WHERE mul.link_id IS NULL;

DELETE FROM macro_user_links WHERE link_id IS NULL;

ALTER TABLE macro_user_links
    ALTER COLUMN link_id SET NOT NULL;

ALTER TABLE macro_user_links
    ADD PRIMARY KEY (primary_macro_id, child_macro_id, link_id);

CREATE INDEX IF NOT EXISTS macro_user_links_link_idx
    ON macro_user_links (link_id);
