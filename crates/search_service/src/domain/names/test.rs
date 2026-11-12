use std::{sync::Arc, time::Duration};

use macro_user_id::user_id::MacroUserIdStr;
use models_search::names::{
    MAX_EXACT_MATCHES, MAX_NAMES, MAX_NEAR_MATCHES, NameKind, NameQuery, NameSearchRequest,
    NamedItem,
};
use uuid::Uuid;

use super::{
    Candidate, NameLookup, NameLookupError, NameSource, NameSourceError, NameViewer, Needle,
};

/// A source that answers from a fixed list, filtering by needle like a real one.
struct Fixed {
    kinds: &'static [NameKind],
    candidates: Vec<Candidate>,
}

#[async_trait::async_trait]
impl NameSource for Fixed {
    fn kinds(&self) -> &'static [NameKind] {
        self.kinds
    }

    async fn find(
        &self,
        _viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        Ok(self
            .candidates
            .iter()
            .filter(|candidate| {
                needles
                    .iter()
                    .any(|needle| candidate.name.to_lowercase().contains(needle.as_str()))
            })
            .cloned()
            .collect())
    }
}

/// A source that never answers.
struct Stuck;

#[async_trait::async_trait]
impl NameSource for Stuck {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Agent]
    }

    async fn find(
        &self,
        _viewer: &NameViewer,
        _kinds: &[NameKind],
        _needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        std::future::pending().await
    }
}

/// A source that fails.
struct Broken;

#[async_trait::async_trait]
impl NameSource for Broken {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Database]
    }

    async fn find(
        &self,
        _viewer: &NameViewer,
        _kinds: &[NameKind],
        _needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        Err(NameSourceError::Internal(rootcause::report!("down")))
    }
}

fn viewer() -> NameViewer {
    NameViewer {
        user: MacroUserIdStr::try_from("macro|viewer@example.com".to_string())
            .expect("valid user id"),
        team: None,
    }
}

fn channel(name: &str) -> Candidate {
    Candidate {
        item: NamedItem::Channel { id: Uuid::now_v7() },
        name: name.to_string(),
        aliases: Vec::new(),
    }
}

fn folder(name: &str) -> Candidate {
    Candidate {
        item: NamedItem::Project { id: Uuid::now_v7() },
        name: name.to_string(),
        aliases: Vec::new(),
    }
}

fn query(name: &str, kinds: &[NameKind]) -> NameQuery {
    NameQuery {
        name: name.to_string(),
        kinds: kinds.to_vec(),
    }
}

fn request(names: Vec<NameQuery>) -> NameSearchRequest {
    NameSearchRequest { names }
}

fn lookup(sources: Vec<Arc<dyn NameSource>>) -> NameLookup {
    NameLookup::new(sources)
}

fn channels(names: &[&str]) -> Arc<dyn NameSource> {
    Arc::new(Fixed {
        kinds: &[NameKind::Channel],
        candidates: names.iter().map(|name| channel(name)).collect(),
    })
}

fn names_of(response: &models_search::names::NameResult) -> Vec<(&str, bool)> {
    response
        .matches
        .iter()
        .map(|m| (m.name.as_str(), m.exact))
        .collect()
}

#[tokio::test]
async fn exact_name_comes_first_and_ignores_case_and_hash() {
    let lookup = lookup(vec![channels(&[
        "bug-reports-archive",
        "Bug-Reports",
        "old-bug-reports",
    ])]);

    let response = lookup
        .lookup(&viewer(), request(vec![query("#bug-reports", &[])]))
        .await
        .expect("lookup");

    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].name, "#bug-reports");
    assert_eq!(
        names_of(&response.results[0]),
        vec![
            ("Bug-Reports", true),
            ("bug-reports-archive", false),
            ("old-bug-reports", false),
        ]
    );
    assert!(response.unavailable.is_empty());
}

#[tokio::test]
async fn finds_a_folder_named_like_a_project() {
    let lookup = lookup(vec![
        channels(&["engineering"]),
        Arc::new(Fixed {
            kinds: &[NameKind::Project],
            candidates: vec![folder("Q4 Launch")],
        }),
    ]);

    let response = lookup
        .lookup(&viewer(), request(vec![query("q4  launch", &[])]))
        .await
        .expect("lookup");

    let matches = &response.results[0].matches;
    assert_eq!(matches.len(), 1);
    assert!(matches[0].exact);
    assert_eq!(matches[0].item.kind(), NameKind::Project);
}

#[tokio::test]
async fn kinds_limit_the_matches() {
    let lookup = lookup(vec![
        channels(&["launch"]),
        Arc::new(Fixed {
            kinds: &[NameKind::Project],
            candidates: vec![folder("Launch")],
        }),
    ]);

    let response = lookup
        .lookup(
            &viewer(),
            request(vec![
                query("launch", &[NameKind::Channel]),
                query("launch", &[NameKind::Project]),
            ]),
        )
        .await
        .expect("lookup");

    assert_eq!(response.results[0].matches.len(), 1);
    assert_eq!(
        response.results[0].matches[0].item.kind(),
        NameKind::Channel
    );
    assert_eq!(response.results[1].matches.len(), 1);
    assert_eq!(
        response.results[1].matches[0].item.kind(),
        NameKind::Project
    );
}

#[tokio::test]
async fn a_person_matches_on_first_name_or_email() {
    let lookup = lookup(vec![Arc::new(Fixed {
        kinds: &[NameKind::Person],
        candidates: vec![Candidate {
            item: NamedItem::Person {
                id: MacroUserIdStr::try_from("macro|eric@example.com".to_string())
                    .expect("valid user id"),
            },
            name: "Eric Stone".to_string(),
            aliases: vec!["Eric".to_string(), "eric@example.com".to_string()],
        }],
    })]);

    let response = lookup
        .lookup(
            &viewer(),
            request(vec![
                query("@Eric", &[]),
                query("Eric Stone", &[]),
                query("Er", &[]),
            ]),
        )
        .await
        .expect("lookup");

    assert!(response.results[0].matches[0].exact);
    assert!(response.results[1].matches[0].exact);
    assert!(!response.results[2].matches[0].exact);
}

#[tokio::test]
async fn near_matches_are_capped_prefix_first() {
    let mut names: Vec<String> = (0..10).map(|n| format!("old-eng-{n}")).collect();
    names.push("eng-announcements".to_string());
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let lookup = lookup(vec![channels(&names)]);

    let response = lookup
        .lookup(&viewer(), request(vec![query("eng", &[])]))
        .await
        .expect("lookup");

    let matches = &response.results[0].matches;
    assert_eq!(matches.len(), MAX_NEAR_MATCHES);
    assert_eq!(matches[0].name, "eng-announcements");
    assert!(matches.iter().all(|m| !m.exact));
}

#[tokio::test]
async fn exact_matches_are_capped() {
    let names = vec!["Notes"; MAX_EXACT_MATCHES + 3];
    let lookup = lookup(vec![channels(&names)]);

    let response = lookup
        .lookup(&viewer(), request(vec![query("notes", &[])]))
        .await
        .expect("lookup");

    assert_eq!(response.results[0].matches.len(), MAX_EXACT_MATCHES);
}

#[tokio::test]
async fn a_failed_or_slow_source_is_reported_unavailable() {
    let lookup = lookup(vec![channels(&["ops"]), Arc::new(Stuck), Arc::new(Broken)])
        .with_timeout(Duration::from_millis(20));

    let response = lookup
        .lookup(&viewer(), request(vec![query("ops", &[])]))
        .await
        .expect("lookup");

    assert_eq!(response.results[0].matches.len(), 1);
    assert_eq!(
        response.unavailable,
        vec![NameKind::Database, NameKind::Agent]
    );
}

#[tokio::test]
async fn sources_for_kinds_not_asked_for_are_not_called() {
    let lookup = lookup(vec![channels(&["ops"]), Arc::new(Broken)]);

    let response = lookup
        .lookup(&viewer(), request(vec![query("ops", &[NameKind::Channel])]))
        .await
        .expect("lookup");

    assert!(response.unavailable.is_empty());
}

#[tokio::test]
async fn refuses_bad_requests() {
    let lookup = lookup(vec![channels(&["ops"])]);

    let empty = lookup.lookup(&viewer(), request(vec![])).await;
    assert_eq!(empty.err(), Some(NameLookupError::NoNames));

    let many = lookup
        .lookup(
            &viewer(),
            request(
                (0..=MAX_NAMES)
                    .map(|n| query(&format!("n{n}"), &[]))
                    .collect(),
            ),
        )
        .await;
    assert_eq!(many.err(), Some(NameLookupError::TooManyNames));

    let blank = lookup
        .lookup(
            &viewer(),
            request(vec![query("ops", &[]), query(" # ", &[])]),
        )
        .await;
    assert_eq!(blank.err(), Some(NameLookupError::EmptyName(1)));

    let long = lookup
        .lookup(&viewer(), request(vec![query(&"x".repeat(201), &[])]))
        .await;
    assert_eq!(long.err(), Some(NameLookupError::NameTooLong(0)));
}

#[test]
fn needles_normalize() {
    assert_eq!(
        Needle::parse("  #Design  Feedback ").unwrap().as_str(),
        "design feedback"
    );
    assert_eq!(Needle::parse("@riley").unwrap().as_str(), "riley");
    assert_eq!(Needle::parse("##x").unwrap().as_str(), "#x");
    assert!(Needle::parse(" @ ").is_none());
}
