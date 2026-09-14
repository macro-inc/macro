use crate::api::context::ApiContext;
use cookie::{Cookie, SameSite};
use email::domain::ports::{FirstInboxProvisionOutcome, FirstInboxProvisioner};
use macro_auth::constant::{MACRO_ACCESS_TOKEN_COOKIE, MACRO_REFRESH_TOKEN_COOKIE};
use macro_env::Environment;
use macro_env_var::maybe_env_vars;
use rand::{Rng, seq::SliceRandom};
use url::Url;

maybe_env_vars! {
    struct FrontendPort;
    struct AppBaseUrl;
}

/// Generates a random 25 character session code
pub fn generate_session_code() -> String {
    const CHARSET_LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    const CHARSET_UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const CHARSET_NUMBERS: &[u8] = b"0123456789";

    let mut rng = rand::rng();
    let mut code = String::with_capacity(25);

    // Ensure at least one character from each set
    code.push(CHARSET_LOWER[rng.random_range(0..CHARSET_LOWER.len())] as char);
    code.push(CHARSET_UPPER[rng.random_range(0..CHARSET_UPPER.len())] as char);
    code.push(CHARSET_NUMBERS[rng.random_range(0..CHARSET_NUMBERS.len())] as char);

    // Combine all charsets for remaining characters
    let combined_charset: Vec<u8> = CHARSET_LOWER
        .iter()
        .chain(CHARSET_UPPER)
        .chain(CHARSET_NUMBERS)
        .copied()
        .collect();

    // Fill the remaining 22 characters
    for _ in 0..22 {
        let idx = rng.random_range(0..combined_charset.len());
        code.push(combined_charset[idx] as char);
    }

    // Shuffle the entire code to avoid predictable character positions
    let mut code_chars: Vec<char> = code.chars().collect();
    code_chars.shuffle(&mut rng);

    code_chars.into_iter().collect()
}

/// Returns the default redirect url based on the environment
///
/// `APP_BASE_URL` takes precedence when set. A self-hosted deployment serves
/// the app from a domain no built-in default can know, and without it every
/// post-login redirect would land on `localhost`. Unset in Macro's own
/// environments, which keep the per-environment defaults below.
pub fn default_redirect_url() -> Url {
    if let Some(base) = AppBaseUrl::new() {
        if let Ok(url) = base.as_ref().parse::<Url>() {
            return url;
        }
    }
    match Environment::new_or_prod() {
        Environment::Local => {
            let port = FrontendPort::new()
                .map(|port| port.to_string())
                .unwrap_or_else(|| "3000".to_string());
            format!("http://localhost:{port}").parse().unwrap()
        }
        Environment::Develop => "https://dev.macro.com/app".parse().unwrap(),
        Environment::Production => "https://macro.com/app".parse().unwrap(),
    }
}

fn domain<'a>() -> Option<&'a str> {
    match Environment::new_or_prod() {
        Environment::Local => None,
        Environment::Production | Environment::Develop => Some("macro.com"),
    }
}

fn same_site() -> SameSite {
    match Environment::new_or_prod() {
        Environment::Production => SameSite::Strict,
        Environment::Local | Environment::Develop => SameSite::None,
    }
}

pub fn create_access_token_cookie(token: &str) -> Cookie<'static> {
    let same_site = same_site();
    let domain = domain();
    let access_token_cookie_name = match Environment::new_or_prod() {
        Environment::Production => MACRO_ACCESS_TOKEN_COOKIE.to_string(),
        Environment::Develop => format!("dev-{MACRO_ACCESS_TOKEN_COOKIE}"),
        Environment::Local => format!("local-{MACRO_ACCESS_TOKEN_COOKIE}"),
    };

    let mut cookie = Cookie::new(
        access_token_cookie_name,
        token.to_owned(), // Convert the borrowed str to an owned String
    );
    cookie.set_secure(true);
    cookie.set_http_only(true);
    cookie.set_same_site(same_site);
    if let Some(domain) = domain {
        cookie.set_domain(domain);
    }
    cookie.set_path("/");
    cookie.set_expires(Some(
        time::OffsetDateTime::now_utc() + time::Duration::days(365),
    ));
    cookie
}

pub fn create_refresh_token_cookie(token: &str) -> Cookie<'static> {
    let same_site = same_site();
    let domain = domain();
    let refresh_token_cookie_name = match Environment::new_or_prod() {
        Environment::Production => MACRO_REFRESH_TOKEN_COOKIE.to_string(),
        Environment::Develop => format!("dev-{MACRO_REFRESH_TOKEN_COOKIE}"),
        Environment::Local => format!("local-{MACRO_REFRESH_TOKEN_COOKIE}"),
    };
    let mut cookie = Cookie::new(
        refresh_token_cookie_name,
        token.to_owned(), // Convert the borrowed str to an owned String
    );
    cookie.set_secure(true);
    cookie.set_http_only(true);
    cookie.set_same_site(same_site);
    if let Some(domain) = domain {
        cookie.set_domain(domain);
    }
    cookie.set_path("/");
    cookie.set_expires(Some(
        time::OffsetDateTime::now_utc() + time::Duration::days(365),
    ));
    cookie
}

/// If this account was created during the auth flow that is completing (the
/// create-user webhook marks it in the cache), appends `signed_up=true` to the
/// redirect URL so the app can attribute the session as a signup for
/// analytics. Best-effort: never fails the login.
pub async fn append_signed_up_param_if_new_user(
    macro_cache_client: &macro_cache_client::MacroCache,
    email: &str,
    redirect_url: &mut Url,
) {
    match macro_cache_client.take_user_just_signed_up(email).await {
        Ok(true) => {
            redirect_url
                .query_pairs_mut()
                .append_pair("signed_up", "true");
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error=?e, "unable to check just-signed-up marker");
        }
    }
}

/// Provisions the user's primary inbox as a side effect of authentication,
/// the moment a fresh access token exists. Fire-and-forget so the login
/// response is never delayed. The email service arbitrates: a login without a
/// usable Gmail grant is an expected no-op, and init is idempotent and recurs
/// on every login, so a lost attempt only delays provisioning until the next one.
pub fn spawn_first_inbox_provision(ctx: &ApiContext, access_token: &str) {
    let email_service_client = ctx.email_service_client.clone();
    let access_token = access_token.to_string();

    tokio::spawn(async move {
        match email_service_client
            .provision_first_inbox(&access_token)
            .await
        {
            Ok(FirstInboxProvisionOutcome::Provisioned) => {
                tracing::info!("first-inbox provision: inbox initialized on login");
            }
            Ok(FirstInboxProvisionOutcome::Skipped) => {}
            Err(e) => {
                tracing::warn!(error=?e, "first-inbox provision: init failed");
            }
        }
    });
}
