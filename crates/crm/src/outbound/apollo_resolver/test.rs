use super::*;
use crate::domain::company_metadata_resolver::CompanyMetadataResolver;
use serde_json::json;

/// The documented Apollo sample payload maps onto every field, and the
/// `account` / `account_id` keys are stripped from `raw`.
#[test]
fn maps_full_apollo_organization() {
    let org = json!({
        "id": "5e66b6381e05b4008c8331b8",
        "name": "Apollo.io",
        "website_url": "http://www.apollo.io",
        "linkedin_url": "http://www.linkedin.com/company/apolloio",
        "twitter_url": "https://twitter.com/meetapollo/",
        "facebook_url": "https://www.facebook.com/MeetApollo",
        "logo_url": "https://example.com/logo.png",
        "founded_year": 2015,
        "industry": "information technology & services",
        "keywords": ["sales engagement", "lead generation"],
        "technology_names": ["AI", "Android"],
        "estimated_num_employees": 1600,
        "annual_revenue": 100000000_i64,
        "annual_revenue_printed": "100M",
        "total_funding": 251200000_i64,
        "total_funding_printed": "251.2M",
        "latest_funding_stage": "Series D",
        "latest_funding_round_date": "2023-08-01T00:00:00.000+00:00",
        "short_description": "Apollo.io combines a buyer database.",
        "raw_address": "415 Mission St, Floor 37, San Francisco, California 94105, US",
        "street_address": "415 Mission St",
        "city": "San Francisco",
        "state": "California",
        "postal_code": "94105-2301",
        "country": "United States",
        "account_id": "63f53afe4ceeca00016bdd37",
        "account": { "id": "63f53afe4ceeca00016bdd37", "team_id": "ours" }
    });

    let md = map_organization(&org);

    assert_eq!(md.name.as_deref(), Some("Apollo.io"));
    assert_eq!(
        md.description.as_deref(),
        Some("Apollo.io combines a buyer database.")
    );
    assert_eq!(md.icon_url.as_deref(), Some("https://example.com/logo.png"));
    assert_eq!(
        md.apollo_organization_id.as_deref(),
        Some("5e66b6381e05b4008c8331b8")
    );
    assert_eq!(md.website_url.as_deref(), Some("http://www.apollo.io"));
    assert_eq!(
        md.linkedin_url.as_deref(),
        Some("http://www.linkedin.com/company/apolloio")
    );
    assert_eq!(
        md.industry.as_deref(),
        Some("information technology & services")
    );
    assert_eq!(md.keywords, vec!["sales engagement", "lead generation"]);
    assert_eq!(md.technologies, vec!["AI", "Android"]);
    assert_eq!(md.estimated_num_employees, Some(1600));
    assert_eq!(md.annual_revenue, Some(100_000_000));
    assert_eq!(md.annual_revenue_printed.as_deref(), Some("100M"));
    assert_eq!(md.total_funding, Some(251_200_000));
    assert_eq!(md.latest_funding_stage.as_deref(), Some("Series D"));
    assert_eq!(md.founded_year, Some(2015));
    assert_eq!(md.city.as_deref(), Some("San Francisco"));
    assert_eq!(md.country.as_deref(), Some("United States"));
    assert!(md.latest_funding_round_date.is_some());

    let raw = md.raw.expect("raw present");
    assert!(raw.get("account").is_none(), "account stripped from raw");
    assert!(
        raw.get("account_id").is_none(),
        "account_id stripped from raw"
    );
    assert_eq!(raw.get("name").and_then(Value::as_str), Some("Apollo.io"));
}

/// A sparse / empty organization collapses to an all-empty metadata
/// (negative-cache row), with `raw` still present.
#[test]
fn missing_fields_collapse_to_empty() {
    let md = map_organization(&json!({}));

    assert_eq!(md.name, None);
    assert_eq!(md.annual_revenue, None);
    assert_eq!(md.latest_funding_round_date, None);
    assert!(md.keywords.is_empty());
    assert!(md.technologies.is_empty());
    assert!(md.raw.is_some());
}

/// Mistyped fields are tolerated: a string revenue / blank name don't
/// blow up the whole mapping.
#[test]
fn tolerates_mistyped_and_blank_fields() {
    let org = json!({
        "name": "   ",
        "annual_revenue": "not a number",
        "estimated_num_employees": 42,
        "keywords": ["ok", "", 123, "  spaced  "],
    });

    let md = map_organization(&org);

    assert_eq!(md.name, None, "blank name -> None");
    assert_eq!(md.annual_revenue, None, "string revenue -> None");
    assert_eq!(md.estimated_num_employees, Some(42));
    assert_eq!(
        md.keywords,
        vec!["ok", "spaced"],
        "blank / non-string elements dropped"
    );
}

/// Live smoke test against the real Apollo API. Ignored by default — it
/// makes a network call and consumes an Apollo credit. Run with:
///   APOLLO_API_KEY=<key> cargo test -p crm apollo_live -- --ignored --nocapture
/// Optionally set APOLLO_TEST_DOMAIN (defaults to "macro.com").
#[tokio::test]
#[ignore = "hits the live Apollo API; requires APOLLO_API_KEY"]
async fn apollo_live_enrich() {
    let api_key = std::env::var("APOLLO_API_KEY").expect("set APOLLO_API_KEY to run this test");
    let domain = std::env::var("APOLLO_TEST_DOMAIN").unwrap_or_else(|_| "macro.com".to_string());

    let resolver = ApolloCompanyMetadataResolver::new(api_key);
    let md = resolver.resolve(&domain).await;

    println!("DomainMetadata for {domain}:\n{md:#?}");
    assert!(
        md.name.is_some() || md.raw.is_some(),
        "expected Apollo data for {domain}; got empty — check API key, credits, or domain",
    );
}
