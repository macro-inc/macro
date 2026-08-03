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

    let results = service
        .search_skills(&user(), "skill", SkillMatchType::Partial)
        .await
        .unwrap();

    let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["newest", "newer", "older", "never-updated"]);
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
    assert_eq!(names, vec!["newest", "older", "never-updated"]);
}

#[tokio::test]
async fn lister_errors_are_propagated() {
    let service = SkillServiceImpl::new(FakeSearcher::unused(), FakeLister::failing());

    let error = service.list_skills(&user()).await.unwrap_err();

    assert!(matches!(error, SkillError::ListFailed(_)));
}
