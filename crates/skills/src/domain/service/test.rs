use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, EntityAccessReceipt, EntityType, ViewAccessLevel,
};

use crate::domain::model::SkillDocumentMetadata;

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
    let service = discovery_service(FakeSearcher::returning(vec![]), FakeLister::unused());

    let error = service
        .search_skills(&user(), "   ", SkillMatchType::Partial)
        .await
        .unwrap_err();

    assert!(matches!(error, SkillError::InvalidRequest(_)));
}

#[tokio::test]
async fn search_results_are_sorted_most_recently_updated_first() {
    let service = discovery_service(
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
    let service = discovery_service(FakeSearcher::returning(vec![]), FakeLister::unused());

    let results = service
        .search_skills(&user(), "catch me up", SkillMatchType::Partial)
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![SkillSummary {
            document_id: system_skills::catch_me_up::SKILL.id(),
            name: "Catch Me Up".to_string(),
            updated_at: None,
        }]
    );
}

#[tokio::test]
async fn search_excludes_non_matching_system_skills() {
    // "yester" alone only prefix-matches when partial; exact must not match.
    let partial = discovery_service(FakeSearcher::returning(vec![]), FakeLister::unused())
        .search_skills(&user(), "yester", SkillMatchType::Partial)
        .await
        .unwrap();
    let exact = discovery_service(FakeSearcher::returning(vec![]), FakeLister::unused())
        .search_skills(&user(), "yester", SkillMatchType::Exact)
        .await
        .unwrap();

    assert_eq!(partial.len(), 1);
    assert!(exact.is_empty());
}

#[tokio::test]
async fn system_skill_matching_requires_adjacent_tokens() {
    let service = discovery_service(FakeSearcher::returning(vec![]), FakeLister::unused());

    // "catch up" skips the middle token, so the phrase must not match.
    let results = service
        .search_skills(&user(), "catch up", SkillMatchType::Partial)
        .await
        .unwrap();

    assert!(results.is_empty());
}

#[tokio::test]
async fn searcher_errors_are_propagated() {
    let service = discovery_service(FakeSearcher::failing(), FakeLister::unused());

    let error = service
        .search_skills(&user(), "skill", SkillMatchType::Partial)
        .await
        .unwrap_err();

    assert!(matches!(error, SkillError::SearchFailed(_)));
}

#[tokio::test]
async fn listed_skills_are_sorted_most_recently_updated_first() {
    let service = discovery_service(
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
    let service = discovery_service(FakeSearcher::unused(), FakeLister::returning(vec![]));

    let results = service.list_skills(&user()).await.unwrap();

    let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names.len(), system_skills::SYSTEM_SKILLS.len());
    for system in system_skills::SYSTEM_SKILLS {
        assert!(names.contains(&system.name));
    }
}

#[tokio::test]
async fn lister_errors_are_propagated() {
    let service = discovery_service(FakeSearcher::unused(), FakeLister::failing());

    let error = service.list_skills(&user()).await.unwrap_err();

    assert!(matches!(error, SkillError::ListFailed(_)));
}

fn discovery_service(
    searcher: FakeSearcher,
    lister: FakeLister,
) -> SkillServiceImpl<FakeSearcher, FakeLister, FakeReader> {
    SkillServiceImpl::new(searcher, lister, FakeReader::unused())
}

use entity_access::domain::models::{
    AccessError, EntityAccessReceipt, EntityType, ViewAccessLevel,
};

struct FakeReader {
    allowed: bool,
    document: Option<SkillDocumentMetadata>,
    content: Mutex<Option<Result<String, SkillError>>>,
    calls: Mutex<Vec<&'static str>>,
}

impl FakeReader {
    fn unused() -> Self {
        Self {
            allowed: false,
            document: None,
            content: Mutex::new(None),
            calls: Mutex::new(vec![]),
        }
    }

    fn skill() -> Self {
        Self {
            allowed: true,
            document: Some(SkillDocumentMetadata {
                name: "Review code".into(),
                sub_type: Some(document_sub_type::DocumentSubType::Skill),
                file_type: Some("md".into()),
                deleted: false,
            }),
            content: Mutex::new(Some(Ok("# Review\n\nFollow every step.\n".into()))),
            calls: Mutex::new(vec![]),
        }
    }
}

impl SkillReader for FakeReader {
    async fn authorize(
        &self,
        user_id: &MacroUserIdStr<'_>,
        document_id: uuid::Uuid,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, SkillError> {
        self.calls.lock().unwrap().push("authorize");
        assert_eq!(user_id, &user());
        if !self.allowed {
            return Err(SkillError::AccessDenied(AccessError::Unauthorized));
        }
        Ok(EntityAccessReceipt::dangerously_assert_authenticated_user(
            user(),
            &document_id.to_string(),
            EntityType::Document,
        ))
    }

    async fn metadata(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SkillDocumentMetadata, SkillError> {
        self.calls.lock().unwrap().push("metadata");
        assert_eq!(receipt.get_authenticated_user().unwrap(), &user());
        self.document
            .clone()
            .ok_or_else(|| SkillError::ReadFailed(anyhow::anyhow!("missing document")))
    }

    async fn markdown(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, SkillError> {
        self.calls.lock().unwrap().push("markdown");
        assert_eq!(receipt.get_authenticated_user().unwrap(), &user());
        self.content
            .lock()
            .unwrap()
            .take()
            .expect("unexpected markdown read")
    }
}

fn reading_service(reader: FakeReader) -> SkillServiceImpl<FakeSearcher, FakeLister, FakeReader> {
    SkillServiceImpl::new(FakeSearcher::unused(), FakeLister::unused(), reader)
}

#[tokio::test]
async fn read_returns_complete_markdown_after_authorization() {
    let service = reading_service(FakeReader::skill());
    let id = uuid::Uuid::from_u128(1);
    let result = service.read_skill(&user(), id).await.unwrap();
    assert_eq!(
        result,
        SkillContent {
            document_id: id,
            name: "Review code".into(),
            content: "# Review\n\nFollow every step.\n".into()
        }
    );
    assert_eq!(
        *service.reader.calls.lock().unwrap(),
        ["authorize", "metadata", "markdown"]
    );
}

#[tokio::test]
async fn denied_reads_never_fetch_metadata_or_content() {
    let service = reading_service(FakeReader::unused());
    assert!(matches!(
        service.read_skill(&user(), uuid::Uuid::from_u128(1)).await,
        Err(SkillError::AccessDenied(_))
    ));
    assert_eq!(*service.reader.calls.lock().unwrap(), ["authorize"]);
}

#[tokio::test]
async fn non_skills_deleted_documents_and_non_markdown_are_rejected_before_content() {
    for invalid in 0..3 {
        let mut reader = FakeReader::skill();
        let document = reader.document.as_mut().unwrap();
        match invalid {
            0 => document.sub_type = None,
            1 => document.deleted = true,
            _ => document.file_type = Some("pdf".into()),
        }
        let service = reading_service(reader);
        assert!(matches!(
            service.read_skill(&user(), uuid::Uuid::from_u128(1)).await,
            Err(SkillError::NotASkill)
        ));
        assert_eq!(
            *service.reader.calls.lock().unwrap(),
            ["authorize", "metadata"]
        );
    }
}

#[tokio::test]
async fn listed_system_skills_can_be_read_without_document_access() {
    let service = discovery_service(FakeSearcher::unused(), FakeLister::returning(vec![]));
    for summary in service.list_skills(&user()).await.unwrap() {
        let result = service
            .read_skill(&user(), summary.document_id)
            .await
            .unwrap();
        assert_eq!(result.name, summary.name);
        assert_eq!(
            result.content,
            system_skills::system_skill(summary.document_id)
                .unwrap()
                .render_content()
        );
    }
    assert!(service.reader.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_documents_and_content_failures_are_propagated() {
    let mut missing = FakeReader::skill();
    missing.document = None;
    let service = reading_service(missing);
    assert!(matches!(
        service.read_skill(&user(), uuid::Uuid::from_u128(1)).await,
        Err(SkillError::ReadFailed(_))
    ));
    assert_eq!(
        *service.reader.calls.lock().unwrap(),
        ["authorize", "metadata"]
    );

    let reader = FakeReader::skill();
    *reader.content.lock().unwrap() = Some(Err(SkillError::ReadFailed(anyhow::anyhow!(
        "lexical unavailable"
    ))));
    let service = reading_service(reader);
    assert!(matches!(
        service.read_skill(&user(), uuid::Uuid::from_u128(1)).await,
        Err(SkillError::ReadFailed(_))
    ));
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn discovery_and_reading_work_through_json_tool_dispatch() {
    use crate::inbound::toolset::{SkillToolContext, skill_toolset};
    use ai_toolset::{RequestContext, ToolSet};

    let id = uuid::Uuid::from_u128(1);
    let service = SkillServiceImpl::new(
        FakeSearcher::unused(),
        FakeLister::returning(vec![skill(1, "Review code", Some(100))]),
        FakeReader::skill(),
    );
    let context = SkillToolContext::new(service);
    let tools = skill_toolset();
    let listed = tools
        .try_tool_call(
            context.clone(),
            RequestContext::new(user()),
            "ListSkills",
            &serde_json::json!({}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(listed["results"][0]["documentId"], id.to_string());
    let args = serde_json::json!({"documentId": listed["results"][0]["documentId"]});
    let read = tools
        .try_tool_call(
            context.clone(),
            RequestContext::new(user()),
            "ReadSkill",
            &args,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(read["name"], "Review code");
    assert_eq!(read["content"], "# Review\n\nFollow every step.\n");
    assert!(
        tools
            .try_tool_call(
                context,
                RequestContext::new(user()),
                "ReadSkill",
                &serde_json::json!({"documentId":"invalid"})
            )
            .await
            .is_err()
    );
}
