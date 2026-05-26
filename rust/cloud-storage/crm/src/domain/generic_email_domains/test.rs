use super::is_generic_email_domain;

#[test]
fn matches_common_consumer_providers() {
    for domain in [
        "gmail.com",
        "yahoo.com",
        "hotmail.com",
        "outlook.com",
        "icloud.com",
        "aol.com",
        "protonmail.com",
        "yandex.ru",
        "qq.com",
        "msn.com",
        "passport.com",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as a consumer provider"
        );
    }
}

#[test]
fn matches_isp_carryover_domains() {
    for domain in [
        "verizon.net",
        "att.net",
        "sbcglobal.net",
        "comcast.net",
        "earthlink.net",
        "btinternet.com",
        "orange.fr",
        "libero.it",
        "wp.pl",
        "seznam.cz",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as an ISP mailbox"
        );
    }
}

#[test]
fn matches_disposable_inbox_services() {
    for domain in [
        "mailinator.com",
        "10minutemail.com",
        "guerrillamail.com",
        "yopmail.com",
        "burnermail.io",
        "trashmail.com",
        "temp-mail.org",
        "dropmail.me",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as disposable"
        );
    }
}

#[test]
fn matches_alias_forwarders() {
    for domain in [
        "privaterelay.appleid.com",
        "duck.com",
        "duckduckgo.com",
        "mozmail.com",
        "relay.firefox.com",
        "simplelogin.com",
        "anonaddy.com",
        "addy.io",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as an alias forwarder"
        );
    }
}

#[test]
fn matches_reserved_tlds() {
    for domain in [
        "user.local",
        "host.internal",
        "acme.invalid",
        "site.test",
        "site.example",
        "service.localhost",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as reserved TLD"
        );
    }
    for bare in ["localhost", "invalid", "localdomain"] {
        assert!(
            is_generic_email_domain(bare),
            "expected bare reserved label {bare} to be flagged"
        );
    }
}

#[test]
fn match_is_case_insensitive() {
    assert!(is_generic_email_domain("Gmail.com"));
    assert!(is_generic_email_domain("GMAIL.COM"));
    assert!(is_generic_email_domain("Outlook.Co.Uk"));
    assert!(is_generic_email_domain("PrivateRelay.appleid.COM"));
}

#[test]
fn surrounding_whitespace_is_ignored() {
    assert!(is_generic_email_domain("  gmail.com  "));
    assert!(is_generic_email_domain("\tyahoo.com\n"));
}

#[test]
fn www_prefix_is_stripped() {
    assert!(is_generic_email_domain("www.gmail.com"));
    assert!(is_generic_email_domain("WWW.outlook.com"));
    // `www.` only strips at the start — a `www.` in the middle of the
    // domain (vanishingly unlikely in practice, but defensive) stays put.
    assert!(!is_generic_email_domain("foo.www.gmail.com"));
}

#[test]
fn zohomail_is_flagged_but_zoho_is_not() {
    // Zoho the company runs `zoho.com`; their free personal mail
    // service lives at `zohomail.com`. Mixing them up would block real
    // CRM entries for Zoho.
    assert!(is_generic_email_domain("zohomail.com"));
    assert!(!is_generic_email_domain("zoho.com"));
}

#[test]
fn legitimate_company_domains_pass_through() {
    for domain in [
        "anthropic.com",
        "macro.com",
        "acme.io",
        "stripe.com",
        "zoho.com",
        // Subdomains of generic providers aren't on the list — they
        // belong to whoever runs the subdomain, not the parent
        // provider. The lookup is exact-match by design.
        "mail.gmail.com",
        "support.outlook.com",
    ] {
        assert!(
            !is_generic_email_domain(domain),
            "expected {domain} to NOT be flagged"
        );
    }
}

#[test]
fn empty_and_garbage_inputs_are_safe() {
    assert!(!is_generic_email_domain(""));
    assert!(!is_generic_email_domain("   "));
    assert!(!is_generic_email_domain("not-an-email"));
}
