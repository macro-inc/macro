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
//! The same logic applies to vendors a team merely *uses* and to big
//! consumer brands: a flood of automated mail from `github.com`,
//! `stripe.com`, `amazon.com`, or `marriott.com` is
//! product/billing/marketing traffic, not a business relationship, and
//! would seed the CRM with rows nobody is selling to or buying from. We
//! do NOT block law firms, banks, funds, or corporates that show up as
//! real correspondents — only tools, consumer brands, and bulk senders.
//!
//! Entries are kept in six categories so downstream consumers
//! (scoring, retention, alerting) can later distinguish a contact at a
//! big consumer provider from one at a disposable inbox, an alias
//! forwarder, a SaaS/dev-tool vendor, a big consumer-brand domain, or a
//! bulk-mail sending domain. The check ([`is_generic_email_domain`])
//! unions all six plus a small set of suffix rules for RFC-reserved
//! TLDs.

#[cfg(test)]
mod test;

/// Returns `true` when `domain` is a known personal / free email
/// provider, a disposable-mail service, a privacy-relay / alias
/// forwarder, a SaaS / dev-tool vendor, a big consumer brand, a
/// bulk-mail sending domain, or a reserved-namespace TLD. Matching is
/// case-insensitive and tolerates surrounding whitespace and a leading
/// `www.` prefix.
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
        || contains_ci(SAAS_VENDOR_DOMAINS, &normalized)
        || contains_ci(CONSUMER_BRAND_DOMAINS, &normalized)
        || contains_ci(BULK_SENDER_DOMAINS, &normalized)
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
    "tmomail.net", // T-Mobile
    // ---- ISPs / telcos (Canada) ----
    "rogers.com",
    "bell.net",
    "sympatico.ca",
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
    "vivaldi.net", // Vivaldi's free webmail (the browser maker's mail service)
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

/// SaaS, developer-tool, and infrastructure vendors a team *uses*. Mail
/// from these apex domains is overwhelmingly automated
/// product/billing/notification traffic, not company-to-company
/// correspondence, so a vendor row here is CRM noise the same way
/// `gmail.com` is. Apex domains only — the dedicated marketing /
/// notification subdomains these vendors send from live in
/// [`BULK_SENDER_DOMAINS`].
///
/// Deliberately conservative: anything that could be a real
/// correspondent (law firms, banks, funds, PE/VC, corporates, schools)
/// is left off. Note the `apollo.io` (sales SaaS) vs `apollo.com`
/// (Apollo Global Management) split — only the tool is listed.
const SAAS_VENDOR_DOMAINS: &[&str] = &[
    // ---- Developer tooling & infrastructure ----
    "github.com",
    "jetbrains.com",
    "1password.com",
    "agilebits.com", // 1Password's corporate domain
    "namecheap.com",
    "digitalocean.com",
    "pulumi.com",
    "retool.com",
    "zapier.com",
    "cockroachlabs.com",
    "hex.tech",
    "algolia.com",
    "gitbook.com",
    "atlassian.com",
    "digicert.com",
    "ssl.com",
    "resend.dev",
    "mailsoar.com",
    // ---- Auth / identity ----
    "auth0.com",
    "okta.com",
    "stytch.com",
    "descope.com",
    "fusionauth.io",
    // ---- Comms / messaging / data APIs ----
    "twilio.com",
    "livekit.io",
    "svix.com",
    "knock.app",
    "segment.com",
    "merge.dev",
    "plaid.com",
    "flinks.io",
    "flinks.com",
    "stedi.com",
    // ---- Document / PDF / UI SDKs ----
    "pdftron.com",
    "apryse.com",
    "foxitsoftware.com",
    "pspdfkit.com",
    "collabora.com",
    "collaboraoffice.com",
    "gemboxsoftware.com",
    "syncfusion.com",
    "ag-grid.com",
    "liveblocks.io",
    "liquidtext.net",
    "photopea.com",
    // ---- Product analytics & feedback ----
    "datadoghq.com",
    "posthog.com",
    "mixpanel.com",
    "heap.io",
    "tryheap.io",
    "sprig.com",
    "contentsquare.com",
    "vitally.io",
    // ---- AI vendors ----
    "anthropic.com",
    "openai.com",
    // ---- Productivity / collaboration ----
    "slack.com",
    "zoom.us",
    "figma.com",
    "loom.com",
    "notion.so",
    "calendly.com",
    "cal.com",
    "superhuman.com",
    "spikenow.com",
    "eraser.io",
    // ---- CRM / sales / marketing / data platforms ----
    "salesforce.com",
    "hubspot.com",
    "customer.io",
    "zoominfo.com",
    "clearbit.com",
    "clearbit.ca",
    "apollo.io", // sales SaaS — NOT apollo.com (Apollo Global Mgmt)
    "outreach.io",
    "reply.io",
    "copper.com",
    "impact.com",
    "g2.com",
    "pitchbook.com",
    "substack.com",
    "producthunt.com",
    // ---- Hiring / cap table / HR / payroll ----
    "wellfound.com",
    "angel.co",
    "angellist.com",
    "angellisthub.com",
    "lattice.com",
    "gusto.com",
    "rippling.com",
    "justworks.com",
    "adp.com",
    "carta.com",
    // ---- Finance / payments / expense / fintech ----
    "stripe.com",
    "brex.com",
    "mercury.com",
    "ramp.com",
    "tryramp.com",
    "pave.com",
    "guideline.com",
    "sequencehq.com",
    "floatcard.com",
    "capchase.com",
    "freshbooks.com",
    "clickpay.com",
    "escrow.com",
    "coinbase.com",
    "kraken.com",
    "zerohash.com",
    // ---- E-sign / accounting / contract SaaS ----
    "docusign.com",
    "pandadoc.com",
    "xero.com",
    // ---- Procurement / vendor security / compliance / support ----
    "vendr.com",
    "vanta.com",
    "whistic.com",
    "secureframe.com",
    "zendesk.com",
];

/// Big consumer-facing brands — retail, travel/hospitality, telecom,
/// consumer tech, food, entertainment. Their mail is overwhelmingly
/// transactional (orders, bookings, statements) or marketing aimed at
/// individuals, never company-to-company correspondence. Includes the
/// marketing/notification subdomains these brands blast from. As with
/// the vendor list, big *enterprise* tech that's plausibly a real
/// correspondent (Intel, IBM, NetApp, Corning…) is intentionally left
/// off.
const CONSUMER_BRAND_DOMAINS: &[&str] = &[
    // ---- Consumer tech ----
    "google.com",
    "accounts.google.com",
    "docs.google.com",
    "calendar.google.com",
    "allusers.d.calendar.google.com",
    "xwf.google.com",
    "microsoft.com",
    "mail.support.microsoft.com",
    "customersfeedback.microsoft.com",
    "engage.microsoft.com",
    "leave.microsoftstoreemail.com",
    "apple.com",
    "adobe.com",
    "meta.com",
    "fb.com",
    "dell.com",
    "lenovo.com",
    "leave.americas.links.hp.com",
    // ---- Telecom (corporate brand mail) ----
    "verizon.com",
    "att.com",
    // ---- Retail / apparel / consumer goods ----
    "amazon.com",
    "amazon.ca",
    "saks.com",
    "chanel.com",
    "missoni.com",
    "terez.com",
    "adidas-group.com",
    "shutterstock.com",
    "wish.com",
    "email.vistaprint.com",
    "leave.email.aloyoga.com",
    // ---- Travel / hospitality / airlines / dining ----
    "uber.com",
    "replies.uber.com",
    "doordash.com",
    "marriott.com",
    "marriott-sp.com",
    "starwood.com",
    "wyndhamriomar.com",
    "backroads.com",
    "mail.aircanada.com",
    "notifications.flyporter.com",
    "leave.e-mail.amtrak.com",
    "leave.e.sonesta.com",
    "mgs.opentable.com",
    "e.starbucks.com",
    "mistercarwash.com",
    // ---- Real estate (consumer) ----
    "zillow.com",
    "zillowgroup.com",
    "mail.zillow.com",
    "convo.zillow.com",
    // ---- Entertainment / gaming / lifestyle ----
    "leave.engage.xbox.com",
    "helpmail.elderscrollsonline.com",
    "turntable.fm",
    "fanduel.com",
    "jets.nfl.com",
    "volosports.com",
    "chelseapiers.com",
    "ridefox.com",
    "whoop.com",
];

/// Email-service-provider / marketing-automation infrastructure and the
/// dedicated notification / unsubscribe subdomains that SaaS vendors
/// send from. No human ever replies from these, so they're never a
/// contact regardless of the brand behind them. Kept separate from
/// [`SAAS_VENDOR_DOMAINS`] because many are brand-agnostic ESP plumbing.
const BULK_SENDER_DOMAINS: &[&str] = &[
    // ---- HubSpot ----
    "bf08x.hubspotemail.net",
    "bf03.hubspotemail.net",
    "bf02x.hubspotemail.net",
    "bf05x.hubspotemail.net",
    "bf06x.hubspotemail.net",
    "bf10x.hubspotemail.net",
    "bf02.eu1.hubspotemail.net",
    "bf01.hubspotstarter.net",
    "forward.hubspot.com",
    "bcc.hubspot.com",
    "notifybf1.hubspot.com",
    "sslcom.hs-inbox.com",
    // ---- Marketo ----
    "unsub-ab.mktomail.com",
    "unsub-sj.mktomail.com",
    // ---- Mailchimp / Mandrill ----
    "mailin.mcsv.net",
    "unsubscribe.mailchimpapp.net",
    // ---- Oracle (Eloqua / Responsys) ----
    "ca.fbl.en25.com",
    "fbl.en25.com",
    "imh.rsys2.com",
    // ---- Salesforce Marketing Cloud ----
    "32pawhyk2ts8ayix0y02jragc4d91pyr7vmcjqvs7naucdvpgf.hs-1swttma0.na236.le.salesforce.com",
    // ---- Customer.io ----
    "unsubscribe2.customer.io",
    "unsubscribe-eu.customer.io",
    // ---- Other ESPs / bulk platforms ----
    "mx.sailthru.com",
    "listunsub.bluehornet.com",
    "unsubscribe.qemailserver.com",
    "bnc3.mailjet.com",
    "1083664.email.netsuite.com",
    "s6.csa1.acemsc3.com",
    "unsub.spmta.com",
    "cmail19.com",
    "cmail20.com",
    "unsub.beehiiv.com",
    "unsubscribe.iterable.com",
    "unsub-guc-com.glueup.com",
    "product-hunt.intercom-mail.com",
    // ---- Vendor notification / unsubscribe subdomains ----
    "noreply.github.com",
    "reply.github.com",
    "e.atlassian.com",
    "outgoing.mixpanel.com",
    "email.zoominfo.com",
    "mail.notion.so",
    "email.figma.com",
    "email.gusto.com",
    "email.openai.com",
    "mail.anthropic.com",
    "camail.docusign.net",
    "post.xero.com",
    "mail.pandadoc.com",
    "mail.producthunt.com",
    "remail.angel.co",
    "mg.ironcladapp.com",
    "em6416.eraser.io",
    "secureframe.zendesk.com",
    "digitalcertvalidation.com",
];
