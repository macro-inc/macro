use cookie::{Cookie, SameSite};
use macro_auth::constant::{MACRO_ACCESS_TOKEN_COOKIE, MACRO_REFRESH_TOKEN_COOKIE};
use macro_env::Environment;
use rand::{Rng, seq::SliceRandom};
use url::Url;

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
pub fn default_redirect_url() -> Url {
    match Environment::new_or_prod() {
        Environment::Local => "http://localhost:3000".parse().unwrap(), // We don't really care about redirect in local
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
        Environment::Local | Environment::Develop => format!("dev-{MACRO_ACCESS_TOKEN_COOKIE}"),
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
        Environment::Local | Environment::Develop => format!("dev-{MACRO_REFRESH_TOKEN_COOKIE}"),
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
