use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use embedding::{
    Content, Embeddable, EmbeddingModel, KeyedEmbedding, LabeledEmbedding, RerankModel, Reranked,
    SearchResults, VectorStore,
};
use task_dedup::domain::ports::{TaskDedupNotifier, TaskDuplicateJudge, TaskMatchRepo};
use task_dedup::{
    JudgeResult, NewTask, TaskDedupConfig, TaskDedupError, TaskDedupService, TaskDuplicate,
    TaskSearchParameters,
};
use uuid::Uuid;

const DIMS: usize = 4;

type Service = TaskDedupService<DIMS, MockEmbedder, MockVectorDb, MockReranker>;

struct MockEmbedder;

impl EmbeddingModel<DIMS> for MockEmbedder {
    async fn embed(
        &self,
        content: &(dyn Embeddable + Sync),
    ) -> anyhow::Result<Vec<LabeledEmbedding<'static, DIMS>>> {
        Ok(content
            .embedding_content()
            .into_iter()
            .map(|(search_key, text)| LabeledEmbedding {
                search_key,
                content: Content::Owned(text.into_owned()),
                embedding: [0.0; DIMS],
            })
            .collect())
    }
}

#[derive(Clone, Default)]
struct MockVectorDb {
    upserted_embeddings: Arc<Mutex<Vec<Vec<(&'static str, String)>>>>,
    last_query: Arc<Mutex<Option<Vec<&'static str>>>>,
}

impl VectorStore<DIMS> for MockVectorDb {
    type Error = anyhow::Error;
    type Metadata = String;
    type SearchParameters = TaskSearchParameters;

    async fn upsert_embeddings<'a>(
        &self,
        _metadata: String,
        embeddings: Vec<LabeledEmbedding<'a, DIMS>>,
    ) -> anyhow::Result<()> {
        self.upserted_embeddings.lock().unwrap().push(
            embeddings
                .into_iter()
                .map(|field| (field.search_key, field.content.into_owned()))
                .collect(),
        );
        Ok(())
    }

    async fn cosine_search(
        &self,
        query: Vec<KeyedEmbedding<DIMS>>,
        _params: TaskSearchParameters,
    ) -> anyhow::Result<Vec<SearchResults<String, DIMS>>> {
        *self.last_query.lock().unwrap() =
            Some(query.into_iter().map(|field| field.search_key).collect());
        Ok(Vec::new())
    }
}

#[derive(Clone, Default)]
struct MockReranker {
    calls: Arc<Mutex<usize>>,
}

impl RerankModel<DIMS> for MockReranker {
    async fn rerank<'a, T: Send>(
        &self,
        _query: Content<'a>,
        _candidates: Vec<SearchResults<T, DIMS>>,
    ) -> anyhow::Result<Vec<Reranked<T>>> {
        *self.calls.lock().unwrap() += 1;
        Ok(Vec::new())
    }
}

struct MockJudge;

#[async_trait]
impl TaskDuplicateJudge for MockJudge {
    async fn judge(&self, _left: &str, _right: &str) -> JudgeResult {
        JudgeResult {
            is_duplicate: false,
            model: None,
            reason: None,
        }
    }
}

struct MockNotifier;

#[async_trait]
impl TaskDedupNotifier for MockNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

struct MockMatchRepo;

#[async_trait]
impl TaskMatchRepo for MockMatchRepo {
    async fn upsert_match(
        &self,
        _task_id: &str,
        _duplicate_task_id: &str,
        _similarity_score: f64,
        _judge_model: Option<&str>,
        _judge_reason: Option<&str>,
    ) -> Result<(), TaskDedupError> {
        Ok(())
    }

    async fn active_duplicate_component(
        &self,
        document_ids: &[String],
    ) -> Result<Vec<String>, TaskDedupError> {
        Ok(document_ids.to_vec())
    }

    async fn trim_matches(&self, _document_id: &str, _limit: i64) -> Result<(), TaskDedupError> {
        Ok(())
    }

    async fn active_duplicates(
        &self,
        _document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError> {
        Ok(Vec::new())
    }

    async fn dismiss_match(
        &self,
        _document_id: &str,
        _match_id: Uuid,
        _dismissed_by: &str,
    ) -> Result<bool, TaskDedupError> {
        Ok(false)
    }

    async fn match_contains(
        &self,
        _document_id: &str,
        _match_id: Uuid,
    ) -> Result<bool, TaskDedupError> {
        Ok(false)
    }

    async fn match_document_ids(&self, _match_id: Uuid) -> Result<Vec<String>, TaskDedupError> {
        Ok(Vec::new())
    }

    async fn dismiss_match_by_id(&self, _match_id: Uuid) -> Result<(), TaskDedupError> {
        Ok(())
    }

    async fn task_names(
        &self,
        _document_ids: &[String],
    ) -> Result<HashMap<String, String>, TaskDedupError> {
        Ok(HashMap::new())
    }
}

fn service(vector_db: MockVectorDb, reranker: MockReranker) -> Service {
    TaskDedupService::new(
        TaskDedupConfig::default(),
        MockEmbedder,
        vector_db,
        reranker,
        Arc::new(MockJudge),
        Arc::new(MockNotifier),
        Arc::new(MockMatchRepo),
    )
}

fn new_task() -> NewTask {
    NewTask {
        document_id: "NEW".to_string(),
        owner: "owner".to_string(),
        team_id: None,
        title: "Query title".to_string(),
        markdown: "query body".to_string(),
    }
}

#[tokio::test]
async fn detect_embeds_title_when_task_has_no_body() {
    let vector_db = MockVectorDb::default();
    let svc = service(vector_db.clone(), MockReranker::default());
    let mut task = new_task();
    task.markdown.clear();

    let active = svc.detect_new_task(task).await.unwrap();

    assert!(active.is_empty());
    assert_eq!(
        *vector_db.upserted_embeddings.lock().unwrap(),
        vec![vec![("title", "Query title".to_string())]]
    );
    assert_eq!(*vector_db.last_query.lock().unwrap(), Some(vec!["title"]));
}

#[tokio::test]
async fn detect_embeds_body_when_task_has_no_title() {
    let vector_db = MockVectorDb::default();
    let svc = service(vector_db.clone(), MockReranker::default());
    let mut task = new_task();
    task.title.clear();

    let active = svc.detect_new_task(task).await.unwrap();

    assert!(active.is_empty());
    assert_eq!(
        *vector_db.upserted_embeddings.lock().unwrap(),
        vec![vec![("body", "query body".to_string())]]
    );
    assert_eq!(*vector_db.last_query.lock().unwrap(), Some(vec!["body"]));
}

#[tokio::test]
async fn detect_embeds_nothing_when_task_has_no_title_or_body() {
    let vector_db = MockVectorDb::default();
    let reranker = MockReranker::default();
    let svc = service(vector_db.clone(), reranker.clone());
    let mut task = new_task();
    task.title = "   ".to_string();
    task.markdown = "\n\t".to_string();

    let active = svc.detect_new_task(task).await.unwrap();

    assert!(active.is_empty());
    assert!(vector_db.upserted_embeddings.lock().unwrap().is_empty());
    assert!(vector_db.last_query.lock().unwrap().is_none());
    assert_eq!(*reranker.calls.lock().unwrap(), 0);
}
