-- Whether non-admin members may invite users to the team. Defaults to
-- true (any member can invite); team admins can turn it off so that only
-- admins/owners may send invites.
ALTER TABLE team
    ADD COLUMN allow_non_admin_invites BOOLEAN NOT NULL DEFAULT TRUE;
