//! Static list of "generic" / personal-mail-provider domains that
//! should not be promoted into the CRM.
//!
//! CRM rows represent *companies* — when a user sends mail to
//! `jane.doe@gmail.com`, they're emailing a personal account, not a
//! business at gmail.com. Populating `gmail.com` as a company would (a)
//! pollute the team's CRM with a single mega-row that aggregates
//! every Gmail-using contact, and (b) burn an unfurl roundtrip
//! resolving the `gmail.com` homepage for no benefit.
//!
//! This is intentionally distinct from
//! [`email_utils::is_generic_email`], which checks the *local-part* of
//! an address for role-account patterns (`noreply@`, `support@`, etc.).
//! Both filters compose: a contact at `support@gmail.com` is dropped by
//! the role filter; a contact at `jane@gmail.com` is dropped by this
//! domain filter. Together they keep CRM populate focused on real
//! company-to-company correspondence.
//!
//! Entries are kept in three categories so downstream consumers
//! (scoring, retention, alerting) can later distinguish a contact at a
//! big consumer provider from one at a disposable inbox or an alias
//! forwarder. The check ([`is_generic_email_domain`]) unions all
//! three plus a small set of suffix rules for RFC-reserved TLDs.

#[cfg(test)]
mod test;

/// Returns `true` when `domain` is a known personal / free email
/// provider, a disposable-mail service, a privacy-relay / alias
/// forwarder, or a reserved-namespace TLD. Matching is case-insensitive
/// and tolerates surrounding whitespace and a leading `www.` prefix.
pub(crate) fn is_generic_email_domain(domain: &str) -> bool {
    let normalized = normalize_domain(domain);
    if normalized.is_empty() {
        return false;
    }
    if matches_reserved_tld(&normalized) {
        return true;
    }
    contains_ci(CONSUMER_EMAIL_DOMAINS, &normalized)
        || contains_ci(DISPOSABLE_EMAIL_DOMAINS, &normalized)
        || contains_ci(ALIAS_FORWARDER_DOMAINS, &normalized)
}

/// Trim surrounding whitespace, lowercase, and strip a leading `www.`
/// label. We don't attempt IDN/punycode normalization here — the
/// curated lists are all ASCII, and IDN-form variants of consumer
/// providers (e.g. localized brand names) are rare enough to skip.
fn normalize_domain(domain: &str) -> String {
    let lower = domain.trim().to_ascii_lowercase();
    lower
        .strip_prefix("www.")
        .map(String::from)
        .unwrap_or(lower)
}

/// Catches names under RFC 2606 / RFC 6762 / RFC 8375 reserved
/// namespaces (`.test`, `.example`, `.invalid`, `.localhost`, `.local`,
/// `.internal`) plus the bare reserved labels. None of these belong in
/// any CRM under any circumstances — they're never valid public
/// company domains.
fn matches_reserved_tld(domain: &str) -> bool {
    matches!(domain, "localhost" | "invalid" | "localdomain")
        || domain.ends_with(".localhost")
        || domain.ends_with(".local")
        || domain.ends_with(".internal")
        || domain.ends_with(".invalid")
        || domain.ends_with(".test")
        || domain.ends_with(".example")
}

fn contains_ci(haystack: &[&str], needle: &str) -> bool {
    haystack
        .iter()
        .any(|known| known.eq_ignore_ascii_case(needle))
}

/// Mainstream consumer / free-mail providers and ISP-hosted mailboxes.
/// Anything on this list is overwhelmingly used for personal accounts;
/// a custom-domain company would not show up here.
const CONSUMER_EMAIL_DOMAINS: &[&str] = &[
    // ---- Google ----
    "gmail.com",
    "googlemail.com",
    // ---- Microsoft (Outlook / Hotmail / Live / MSN / Passport) ----
    "outlook.com",
    "outlook.co.uk",
    "outlook.fr",
    "outlook.de",
    "outlook.es",
    "outlook.it",
    "outlook.com.au",
    "outlook.com.br",
    "outlook.in",
    "outlook.jp",
    "outlook.kr",
    "outlook.cl",
    "outlook.dk",
    "outlook.ie",
    "outlook.my",
    "outlook.ph",
    "outlook.pt",
    "outlook.sa",
    "outlook.sg",
    "hotmail.com",
    "hotmail.co.uk",
    "hotmail.fr",
    "hotmail.de",
    "hotmail.it",
    "hotmail.es",
    "hotmail.com.br",
    "hotmail.com.ar",
    "hotmail.com.mx",
    "hotmail.com.au",
    "hotmail.be",
    "hotmail.nl",
    "hotmail.ca",
    "hotmail.no",
    "hotmail.se",
    "live.com",
    "live.co.uk",
    "live.fr",
    "live.de",
    "live.it",
    "live.com.au",
    "live.ca",
    "live.nl",
    "live.se",
    "live.no",
    "live.dk",
    "live.fi",
    "live.com.mx",
    "msn.com",
    "passport.com",
    // ---- Yahoo ----
    "yahoo.com",
    "ymail.com",
    "rocketmail.com",
    "yahoo.co.uk",
    "yahoo.fr",
    "yahoo.de",
    "yahoo.it",
    "yahoo.es",
    "yahoo.com.br",
    "yahoo.com.mx",
    "yahoo.com.ar",
    "yahoo.co.in",
    "yahoo.co.jp",
    "yahoo.com.au",
    "yahoo.ca",
    "yahoo.com.sg",
    "yahoo.com.hk",
    "yahoo.com.tw",
    "yahoo.com.ph",
    "yahoo.com.vn",
    "yahoo.com.my",
    "yahoo.no",
    "yahoo.se",
    "yahoo.dk",
    "yahoo.nl",
    "yahoo.gr",
    "yahoo.pt",
    // ---- Apple ----
    "icloud.com",
    "me.com",
    "mac.com",
    // ---- AOL / Verizon (legacy) ----
    "aol.com",
    "aim.com",
    "att.net",
    "bellsouth.net",
    "sbcglobal.net",
    "ameritech.net",
    "verizon.net",
    // ---- Privacy-focused providers ----
    "protonmail.com",
    "proton.me",
    "pm.me",
    "tutanota.com",
    "tutanota.de",
    "tutamail.com",
    "tuta.io",
    "tuta.com",
    "fastmail.com",
    "fastmail.fm",
    "hey.com",
    "hushmail.com",
    "posteo.de",
    "mailbox.org",
    "runbox.com",
    "countermail.com",
    "startmail.com",
    "skiff.com",
    // ---- Germany / DACH ----
    "gmx.com",
    "gmx.de",
    "gmx.net",
    "gmx.at",
    "gmx.ch",
    "gmx.fr",
    "gmx.es",
    "gmx.us",
    "web.de",
    "t-online.de",
    "freenet.de",
    // ---- Russia / CIS ----
    "yandex.com",
    "yandex.ru",
    "ya.ru",
    "mail.ru",
    "list.ru",
    "inbox.ru",
    "bk.ru",
    "rambler.ru",
    "ukr.net",
    // ---- China ----
    "qq.com",
    "163.com",
    "126.com",
    "sina.com",
    "sina.cn",
    "sohu.com",
    "139.com",
    "aliyun.com",
    "foxmail.com",
    "21cn.com",
    // ---- Korea ----
    "naver.com",
    "daum.net",
    "hanmail.net",
    "nate.com",
    // ---- Japan (carrier mailboxes are personal in practice) ----
    "ezweb.ne.jp",
    "docomo.ne.jp",
    "softbank.ne.jp",
    "au.com",
    // ---- Taiwan ----
    "pchome.com.tw",
    // ---- Southeast Asia ----
    "singnet.com.sg",
    // ---- India ----
    "rediffmail.com",
    "indiatimes.com",
    // ---- Brazil ----
    "uol.com.br",
    "bol.com.br",
    "ig.com.br",
    "terra.com.br",
    // ---- ISPs / telcos (US) ----
    "comcast.net",
    "xfinity.com",
    "cox.net",
    "charter.net",
    "spectrum.net",
    "earthlink.net",
    "optonline.net",
    // ---- ISPs / telcos (UK) ----
    "btinternet.com",
    "virginmedia.com",
    // ---- ISPs / telcos (France) ----
    "orange.fr",
    "wanadoo.fr",
    "free.fr",
    "laposte.net",
    // ---- ISPs / telcos (Italy) ----
    "libero.it",
    "alice.it",
    "virgilio.it",
    // ---- ISPs / telcos (Spain) ----
    "telefonica.net",
    // ---- ISPs / telcos (Poland) ----
    "onet.pl",
    "wp.pl",
    "o2.pl",
    "interia.pl",
    // ---- ISPs / telcos (Czech) ----
    "seznam.cz",
    "centrum.cz",
    // ---- Generic / other free providers ----
    "mail.com",
    "email.com",
    "zohomail.com", // intentionally NOT zoho.com — that's the company itself
    "gawab.com",
    "inbox.com",
    "lavabit.com",
    "lycos.com",
    "usa.com",
    "consultant.com",
    "engineer.com",
    "cheerful.com",
    "dr.com",
    "myself.com",
    "linuxmail.org",
    "iname.com",
];

/// Disposable / temporary inbox services. Used by signups that want to
/// avoid commitment — never associated with a real business.
const DISPOSABLE_EMAIL_DOMAINS: &[&str] = &[
    "mailinator.com",
    "mailinator.net",
    "mailinator.org",
    "mailinator2.com",
    "guerrillamail.com",
    "guerrillamail.net",
    "guerrillamail.org",
    "guerrillamailblock.com",
    "sharklasers.com",
    "grr.la",
    "10minutemail.com",
    "tempmail.com",
    "temp-mail.org",
    "temp-mail.io",
    "tempmail.org",
    "tmpmail.org",
    "throwaway.email",
    "trashmail.com",
    "trashmail.de",
    "trashmail.ws",
    "yopmail.com",
    "mvrht.net",
    "maildrop.cc",
    "getairmail.com",
    "dispostable.com",
    "fakeinbox.com",
    "mintemail.com",
    "spambox.us",
    "spamgourmet.com",
    "spam4.me",
    "33mail.com",
    "anonbox.net",
    "mailnesia.com",
    "pokemail.net",
    "bccto.me",
    "chacuo.net",
    "moakt.com",
    "dropmail.me",
    "emailondeck.com",
    "burnermail.io",
    "tempinbox.com",
    "mytemp.email",
    "jetable.org",
    "mailcatch.com",
    "mail-temporaire.fr",
    "wegwerfemail.de",
    "wegwerfmail.de",
    "temporarymail.com",
    "fakemail.net",
    "mailnull.com",
    "tempail.com",
];

/// Privacy-relay / alias-forwarding services. These look like one
/// "company" by domain but actually mask many unrelated personal
/// accounts, so they're useless for CRM grouping. Often missed by
/// off-the-shelf blocklists.
const ALIAS_FORWARDER_DOMAINS: &[&str] = &[
    // Apple Hide-My-Email
    "privaterelay.appleid.com",
    // DuckDuckGo Email Protection
    "duck.com",
    "duckduckgo.com",
    // Mozilla Relay
    "mozmail.com",
    "relay.firefox.com",
    // SimpleLogin (Proton)
    "simplelogin.com",
    "simplelogin.co",
    // AnonAddy / addy.io
    "anonaddy.com",
    "addy.io",
    // Other independents
    "firemail.de",
];
