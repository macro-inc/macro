#![deny(missing_docs)]
//! The canonical list of generic (free / consumer) email provider domains.
//!
//! This is the single source of truth for "is this a company domain?":
//! the onboarding flow's team suggestion, the mobile welcome email's
//! personal-address check, and the colleague direct messages opened when
//! an inbox connects all consult this list. (The CRM keeps its own, much
//! broader list for filtering bulk-mail senders — a different concept; do
//! not merge them.)

#[cfg(test)]
mod test;

/// Generic (free / consumer) email provider domains, sorted for binary
/// search. Keep entries lowercase and in order.
pub const GENERIC_EMAIL_DOMAINS: &[&str] = &[
    "126.com",
    "163.com",
    "aol.com",
    "att.net",
    "bellsouth.net",
    "btinternet.com",
    "charter.net",
    "comcast.net",
    "cox.net",
    "daum.net",
    "duck.com",
    "earthlink.net",
    "fastmail.com",
    "free.fr",
    "gmail.com",
    "gmx.com",
    "gmx.de",
    "gmx.net",
    "googlemail.com",
    "hey.com",
    "hotmail.co.uk",
    "hotmail.com",
    "hotmail.fr",
    "icloud.com",
    "laposte.net",
    "live.com",
    "mac.com",
    "mail.com",
    "mail.ru",
    "me.com",
    "msn.com",
    "naver.com",
    "orange.fr",
    "outlook.com",
    "pm.me",
    "privaterelay.appleid.com",
    "proton.me",
    "protonmail.com",
    "qq.com",
    "rediffmail.com",
    "rocketmail.com",
    "sbcglobal.net",
    "seznam.cz",
    "sina.com",
    "sky.com",
    "t-online.de",
    "tuta.com",
    "tutanota.com",
    "verizon.net",
    "wanadoo.fr",
    "web.de",
    "yahoo.co.in",
    "yahoo.co.uk",
    "yahoo.com",
    "yahoo.fr",
    "yandex.com",
    "yandex.ru",
    "ymail.com",
    "zoho.com",
];

/// Returns true when the email domain belongs to a generic (free /
/// consumer) email provider, so sharing it says nothing about working
/// together. Matching is case-insensitive.
pub fn is_generic_email_domain(domain: &str) -> bool {
    let domain = domain.to_ascii_lowercase();
    GENERIC_EMAIL_DOMAINS
        .binary_search(&domain.as_str())
        .is_ok()
}
