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
fn matches_saas_and_dev_tool_vendors() {
    for domain in [
        "github.com",
        "slack.com",
        "zoom.us",
        "figma.com",
        "stripe.com",
        "anthropic.com",
        "datadoghq.com",
        "auth0.com",
        "carta.com",
        "gusto.com",
        "apollo.io",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as a SaaS/dev-tool vendor"
        );
    }
}

#[test]
fn matches_big_consumer_brands() {
    for domain in [
        "google.com",
        "accounts.google.com",
        "microsoft.com",
        "apple.com",
        "amazon.com",
        "uber.com",
        "doordash.com",
        "marriott.com",
        "e.starbucks.com",
        "zillow.com",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as a big consumer brand"
        );
    }
}

#[test]
fn matches_carrier_mailboxes() {
    for domain in ["tmomail.net", "rogers.com", "bell.net", "sympatico.ca"] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as a carrier mailbox"
        );
    }
}

#[test]
fn matches_bulk_mail_senders() {
    for domain in [
        "bf08x.hubspotemail.net",
        "unsub-ab.mktomail.com",
        "mailin.mcsv.net",
        "noreply.github.com",
        "mail.anthropic.com",
        "outgoing.mixpanel.com",
        "unsubscribe.iterable.com",
        "imh.rsys2.com",
    ] {
        assert!(
            is_generic_email_domain(domain),
            "expected {domain} to be flagged as a bulk-mail sender"
        );
    }
}

#[test]
fn legitimate_company_domains_pass_through() {
    for domain in [
        "macro.com",
        "acme.io",
        "zoho.com",
        // Real correspondents we must never filter: law firms, banks,
        // funds, and universities are genuine CRM relationships even
        // though they send some automated mail.
        "kirkland.com",
        "jpmorgan.com",
        "blackrock.com",
        "a16z.com",
        "harvard.edu",
        // Apollo Global Management (a PE firm) shares a brand with the
        // `apollo.io` sales tool — only the tool is generic.
        "apollo.com",
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
