-- Every Macro Workspace account is a GoAlert admin, from its first sign-in.
-- GoAlert has no default-role setting. Its OIDC login cannot restrict the
-- email domain, so only @macro.com accounts are promoted.
CREATE OR REPLACE FUNCTION macro_workspace_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.email ILIKE '%@macro.com' THEN
    NEW.role := 'admin';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER macro_workspace_admin
  BEFORE INSERT OR UPDATE OF email, role ON users
  FOR EACH ROW EXECUTE FUNCTION macro_workspace_admin();

UPDATE users SET role = 'admin' WHERE email ILIKE '%@macro.com' AND role <> 'admin';
