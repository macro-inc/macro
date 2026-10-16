{
  "server" = {
    http_addr = "127.0.0.1";
    domain = "$__env{GRAFANA_HOST}";
    root_url = "$__env{GRAFANA_ROOT_URL}";
    enforce_domain = true;
  };
  "security" = {
    disable_initial_admin_creation = true;
    secret_key = "$__file{/run/credentials/grafana.service/grafana_secret_key}";
    cookie_secure = true;
    cookie_samesite = "lax";
    strict_transport_security = true;
    content_security_policy = true;
  };
  "users" = {
    allow_sign_up = false;
    allow_org_create = false;
    viewers_can_edit = false;
  };
  "auth" = {
    disable_login_form = true;
    login_maximum_inactive_lifetime_duration = "1h";
    login_maximum_lifetime_duration = "8h";
  };
  "auth.basic" = {
    enabled = false;
  };
  "auth.anonymous" = {
    enabled = false;
  };
  "auth.google" = {
    enabled = true;
    allow_sign_up = true;
    client_id = "$__file{/run/credentials/grafana.service/google_client_id}";
    client_secret = "$__file{/run/credentials/grafana.service/google_client_secret}";
    scopes = "openid email profile";
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth";
    token_url = "https://oauth2.googleapis.com/token";
    api_url = "https://openidconnect.googleapis.com/v1/userinfo";
    allowed_domains = "macro.com";
    hosted_domain = "macro.com";
    validate_hd = true;
    use_pkce = true;
    use_refresh_token = true;
    validate_id_token = true;
    jwk_set_url = "https://www.googleapis.com/oauth2/v3/certs";
    role_attribute_path = "\"'GrafanaAdmin'\"";
    role_attribute_strict = true;
    allow_assign_grafana_admin = true;
    skip_org_role_sync = false;
  };
  "analytics" = {
    reporting_enabled = false;
    check_for_updates = false;
  };
  "plugins" = {
    preinstall_disabled = true;
    preinstall_auto_update = false;
  };
}
