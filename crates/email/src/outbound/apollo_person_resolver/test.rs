use super::*;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn addresses(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

async fn resolver(server: &MockServer) -> ApolloPersonProfileResolver {
    ApolloPersonProfileResolver::with_base_url("test-key".into(), server.uri()).unwrap()
}

#[tokio::test]
async fn maps_matches_positionally_and_drops_unmatched_or_unsure_people() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/people/bulk_match"))
        .and(query_param("reveal_personal_emails", "false"))
        .and(query_param("reveal_phone_number", "false"))
        .and(header("x-api-key", "test-key"))
        .and(body_json(json!({
            "details": [
                { "email": "ada@example.org" },
                { "email": "nobody@example.org" },
                { "email": "maybe@example.org" },
                { "email": "unrated@example.org" }
            ]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "success",
            "matches": [
                {
                    "name": "Ada Example",
                    "linkedin_url": "http://www.linkedin.com/in/ada-example",
                    "title": "VP of Sales Operations",
                    "headline": "VP of Sales Operations at Example",
                    "photo_url": "https://media.example.com/photos/ada.jpg",
                    "match_confidence": "high",
                    "organization": { "name": "Example Inc" }
                },
                null,
                {
                    "headline": "Someone else entirely",
                    "linkedin_url": "https://www.linkedin.com/in/someone-else",
                    "match_confidence": "low"
                },
                {
                    "headline": "No confidence given",
                    "linkedin_url": "https://www.linkedin.com/in/unrated"
                }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let resolution = resolver(&server)
        .await
        .resolve(&addresses(&[
            "ada@example.org",
            "nobody@example.org",
            "maybe@example.org",
            "unrated@example.org",
        ]))
        .await;

    assert_eq!(
        resolution,
        PersonResolution::Resolved(vec![
            PersonProfile {
                email_address: "ada@example.org".into(),
                linkedin_url: Some("https://www.linkedin.com/in/ada-example".into()),
                headline: Some("VP of Sales Operations at Example".into()),
                title: Some("VP of Sales Operations".into()),
                organization_name: Some("Example Inc".into()),
                photo_url: Some("https://media.example.com/photos/ada.jpg".into()),
            },
            PersonProfile::unmatched("nobody@example.org".into()),
            PersonProfile::unmatched("maybe@example.org".into()),
            PersonProfile::unmatched("unrated@example.org".into()),
        ])
    );
}

#[tokio::test]
async fn rate_limits_and_misaligned_bodies_are_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "matches": [null] })))
        .mount(&server)
        .await;
    let resolver = resolver(&server).await;
    let two = addresses(&["a@example.com", "b@example.com"]);

    assert_eq!(resolver.resolve(&two).await, PersonResolution::Unavailable);
    assert_eq!(resolver.resolve(&two).await, PersonResolution::Unavailable);
}

#[tokio::test]
async fn no_api_key_makes_no_call() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let resolver = ApolloPersonProfileResolver::with_base_url(String::new(), server.uri()).unwrap();

    assert_eq!(
        resolver.resolve(&addresses(&["a@example.com"])).await,
        PersonResolution::Unavailable
    );
}

#[test]
fn only_linkedin_hosts_survive_as_https_links() {
    assert_eq!(
        linkedin_profile_url("http://www.linkedin.com/in/ada").as_deref(),
        Some("https://www.linkedin.com/in/ada")
    );
    assert_eq!(
        linkedin_profile_url("https://linkedin.com/in/ada").as_deref(),
        Some("https://linkedin.com/in/ada")
    );
    assert_eq!(linkedin_profile_url("https://evil.com/linkedin.com"), None);
    assert_eq!(
        linkedin_profile_url("https://linkedin.com.evil.com/in/ada"),
        None
    );
    assert_eq!(
        linkedin_profile_url("https://linkedin.com@attacker.example/"),
        None
    );
    assert_eq!(
        linkedin_profile_url("javascript:alert(1)//linkedin.com"),
        None
    );
    assert_eq!(
        linkedin_profile_url("https://attacker.example\\.linkedin.com/in/ada"),
        None
    );
    assert_eq!(
        linkedin_profile_url("https://attacker.example\\@www.linkedin.com/in/ada"),
        None
    );
}

#[test]
fn photos_must_be_https_urls_without_credentials() {
    assert_eq!(
        photo_url("https://media.example.com/ada.jpg").as_deref(),
        Some("https://media.example.com/ada.jpg")
    );
    assert_eq!(photo_url("http://media.example.com/ada.jpg"), None);
    assert_eq!(
        photo_url("https://user:pass@media.example.com/ada.jpg"),
        None
    );
    assert_eq!(photo_url("data:image/png;base64,AAAA"), None);
}
