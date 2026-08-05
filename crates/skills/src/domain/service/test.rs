use std::sync::Mutex;

use chrono::{TimeZone, Utc};

use super::*;

struct FakeSearcher {
    results: Mutex<Option<Result<Vec<SkillSummary>, SkillError>>>,
}

impl FakeSearcher {
    fn returning(results: Vec<SkillSummary>) -> Self {
        Self {
            results: Mutex::new(Some(Ok(results))),
        }
    }

    fn failing() -> Self {
        Self {
            results: Mutex::new(Some(Err(SkillError::SearchFailed(anyhow::anyhow!(
                "search service unavailable"
            ))))),
        }
    }

    fn unused() -> Self {
        Self {
            results: Mutex::new(None),
        }
    }
}

impl SkillSearcher for FakeSearcher {
    async fn search_skills_by_name(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _query: &str,
        _match_type: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        self.results
            .lock()
            .unwrap()
            .take()
            .expect("searcher called more than once")
    }
}

struct FakeLister {
    results: Mutex<Option<Result<Vec<SkillSummary>, SkillError>>>,
}

impl FakeLister {
    fn returning(results: Vec<SkillSummary>) -> Self {
        Self {
            results: Mutex::new(Some(Ok(results))),
        }
    }

    fn failing() -> Self {
        Self {
            results: Mutex::new(Some(Err(SkillError::ListFailed(anyhow::anyhow!(
                "soup service unavailable"
            ))))),
        }
    }

    fn unused() -> Self {
        Self {
            results: Mutex::new(None),
        }
    }
}

impl SkillLister for FakeLister {
    async fn list_skills(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _limit: u16,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        self.results
            .lock()
            .unwrap()
            .take()
            .expect("lister called more than once")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@example.com".to_string()).unwrap()
}

fn skill(id: u128, name: &str, updated_at_secs: Option<i64>) -> SkillSummary {
    SkillSummary {
        document_id: uuid::Uuid::from_u128(id),
        name: name.to_string(),
        updated_at: updated_at_secs.map(|secs| Utc.timestamp_opt(secs, 0).unwrap()),
    }
}

#[tokio::test]
async fn empty_query_is_rejected_without_calling_the_searcher() {
    let service = SkillServiceImpl::new(FakeSearcher::returning(vec![]), FakeLister::unused());

    let error = service
        .search_skills(&user(), "   ", SkillMatchType::Partial)
        .await
        .unwrap_err();

    assert!(matches!(error, SkillError::InvalidRequest(_)));
}

#[tokio::test]
async fn search_results_are_sorted_most_recently_updated_first() {
    let service = SkillServiceImpl::new(
        FakeSearcher::returning(vec![
            skill(1, "older", Some(100)),
            skill(2, "newest", Some(300)),
            skill(3, "never-updated", None),
            skill(4, "newer", Some(200)),
        ]),
        FakeLister::unused(),
    );

    // A query no system skill name matches, so only searcher results return.
    let results = service
        .search_skills(&user(), "quarterly report", SkillMatchType::Partial)
        .await
        .unwrap();

    let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["newest", "newer", "older", "never-updated"]);
}

#[tokio::test]
async fn search_includes_matching_system_skills() {
    let service = SkillServiceImpl::new(FakeSearcher::returning(vec![]), FakeLister::unused());

    let results = service
        .search_skills(&user(), "skill authoring", SkillMatchType::Partial)
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![SkillSummary {
            document_id: system_skills::skill_authoring::SKILL.id(),
            name: "Skill Authoring Guide".to_string(),
            updated_at: None,
        }]
    );
}

#[tokio::test]
async fn search_excludes_non_matching_system_skills() {
    // "author" alone only prefix-matches when partial; exact must not match.
    let partial = SkillServiceImpl::new(FakeSearcher::returning(vec![]), FakeLister::unused())
        .search_skills(&user(), "author", SkillMatchType::Partial)
        .await
        .unwrap();
    let exact = SkillServiceImpl::new(FakeSearcher::returning(vec![]), FakeLister::unused())
        .search_skills(&user(), "author", SkillMatchType::Exact)
        .await
        .unwrap();

    assert_eq!(partial.len(), 1);
    assert!(exact.is_empty());
}

#[tokio::test]
async fn system_skill_matching_requires_adjacent_tokens() {
    let service = SkillServiceImpl::new(FakeSearcher::returning(vec![]), FakeLister::unused());

    // "skill guide" skips the middle token, so the phrase must not match.
    let results = service
        .search_skills(&user(), "skill guide", SkillMatchType::Partial)
        .await
        .unwrap();

    assert!(results.is_empty());
}

#[tokio::test]
async fn searcher_errors_are_propagated() {
    let service = SkillServiceImpl::new(FakeSearcher::failing(), FakeLister::unused());

    let error = service
        .search_skills(&user(), "skill", SkillMatchType::Partial)
        .await
        .unwrap_err();

    assert!(matches!(error, SkillError::SearchFailed(_)));
}

#[tokio::test]
async fn listed_skills_are_sorted_most_recently_updated_first() {
    let service = SkillServiceImpl::new(
        FakeSearcher::unused(),
        FakeLister::returning(vec![
            skill(1, "older", Some(100)),
            skill(2, "newest", Some(300)),
            skill(3, "never-updated", None),
        ]),
    );

    let results = service.list_skills(&user()).await.unwrap();

    let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
    // System skills have no update timestamp, so they sort with (after, by
    // id) the never-updated user skills.
    assert_eq!(names.first(), Some(&"newest"));
    assert_eq!(names.get(1), Some(&"older"));
    assert!(names.contains(&"never-updated"));
    for system in system_skills::SYSTEM_SKILLS {
        assert!(names.contains(&system.name));
    }
}

#[tokio::test]
async fn listing_always_includes_system_skills() {
    let service = SkillServiceImpl::new(FakeSearcher::unused(), FakeLister::returning(vec![]));

    let results = service.list_skills(&user()).await.unwrap();

    let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names.len(), system_skills::SYSTEM_SKILLS.len());
    for system in system_skills::SYSTEM_SKILLS {
        assert!(names.contains(&system.name));
    }
}

#[tokio::test]
async fn lister_errors_are_propagated() {
    let service = SkillServiceImpl::new(FakeSearcher::unused(), FakeLister::failing());

    let error = service.list_skills(&user()).await.unwrap_err();

    assert!(matches!(error, SkillError::ListFailed(_)));
}
