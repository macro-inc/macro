use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

/// The seeded table comes back as the domain's overlays: `sentry` is at its
/// vendor's server, any spelling of that URL finds it, and an app the table
/// does not list is not overlaid.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_the_overlay_table(pool: PgPool) {
    let overlays = PgOverlayCatalog::new(pool).overlays().await.unwrap();

    let sentry = ConnectorId::parse("sentry").unwrap();
    assert!(overlays.is_overlaid(&sentry));
    assert!(!overlays.is_overlaid(&ConnectorId::parse("google_sheets").unwrap()));
    assert!(
        overlays
            .apps_at(&ServerUrl::parse("https://mcp.sentry.dev/mcp/").unwrap())
            .any(|app| *app == sentry)
    );
}

/// Apps whose vendor refuses Macro's client (registration or metadata
/// document), checked 2026-11-22: they are served by Pipedream, not overlaid.
const REFUSE_MACRO: &[&str] = &[
    "air",
    "alegra",
    "alpha_vantage",
    "appcues",
    "appsflyer",
    "autom",
    "benzinga",
    "browser_use",
    "browserless",
    "callrail",
    "campaignhq",
    "canva",
    "canva_enterprise",
    "capturekit",
    "caspio",
    "checkout_com",
    "circleci",
    "contacts",
    "crowdstrike_falcon",
    "decodo",
    "dreamdata",
    "easyship",
    "engagebay",
    "enrow",
    "figma",
    "float",
    "foxy",
    "frame",
    "gamma",
    "gatherup",
    "gong",
    "instantly",
    "intercom",
    "kiyoh",
    "knocommerce",
    "leadfeeder",
    "linearb",
    "lusha",
    "nexudus",
    "octave",
    "olostep",
    "omnisend",
    "onfleet",
    "outseta",
    "partnerize",
    "piloterr",
    "pipefy",
    "printify",
    "prismic",
    "pumble",
    "qase",
    "radar",
    "relevance_ai",
    "returnless",
    "richpanel",
    "rudderstack",
    "runpod",
    "salesloft",
    "semrush",
    "sendcloud",
    "shipstation",
    "sign_plus",
    "simplero",
    "skyciv",
    "square",
    "survey_monkey",
    "tapfiliate",
    "trackvia",
    "voice",
    "weglot",
    "writesonic",
];

/// An app whose vendor refuses Macro's client is not overlaid: an overlay row
/// made it unconnectable and hid its Pipedream connections. Figma's server
/// goes with it, so nothing at that URL is an app.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn apps_that_refuse_macro_are_not_overlaid(pool: PgPool) {
    let overlays = PgOverlayCatalog::new(pool).overlays().await.unwrap();

    for slug in REFUSE_MACRO {
        assert!(
            !overlays.is_overlaid(&ConnectorId::parse(slug).unwrap()),
            "{slug} is still overlaid"
        );
    }
    assert!(
        overlays
            .apps_at(&ServerUrl::parse("https://mcp.figma.com/mcp").unwrap())
            .next()
            .is_none()
    );
}
