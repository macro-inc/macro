use super::*;
use crate::domain::ExecutionStatus;
use code_execution::domain::{Bundle, BundleTarget, Diagnostic, SourceFile};
use entity_access::domain::models::EntityType;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

const PAGE: &str = r#"<p>tasks</p><script type="text/macro" id="tasks" lang="ts">export default async () => 1;</script>"#;

/// The stored document, swappable to simulate an edit.
struct Sources(Mutex<String>);

#[async_trait]
impl DocumentSources for Sources {
    async fn html(
        &self,
        _document: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentSourceError> {
        Ok(self.0.lock().unwrap().clone())
    }
}

/// Accepts every program, failing those whose source says `broken`.
#[derive(Default)]
struct Toolchain {
    checks: AtomicUsize,
}

#[async_trait]
impl ProgramChecker for Toolchain {
    fn sdk_fingerprint(&self) -> &str {
        "test"
    }

    async fn check_files(
        &self,
        files: &[SourceFile],
        _declarations: &str,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        let broken = files.iter().any(|file| file.source.contains("broken"));
        Ok(broken
            .then(|| Diagnostic {
                file: Some("program_0.ts".to_owned()),
                message: "TS2304 [ERROR]: Cannot find name 'broken'.".to_owned(),
            })
            .into_iter()
            .collect())
    }
}

#[async_trait]
impl ProgramBundler for Toolchain {
    async fn bundle(
        &self,
        files: &[SourceFile],
        _entry: &str,
        _target: BundleTarget,
    ) -> Result<Bundle, CheckError> {
        Ok(Bundle::Code(format!("bundle:{}", files[0].source)))
    }
}

/// Records each run's caller, source and inputs.
#[derive(Default)]
struct Runs(Mutex<Vec<(ToolCaller, String, Option<Unattended>)>>);

#[async_trait]
impl UserCodeMode for Runs {
    async fn execute(
        &self,
        _user: &MacroUserIdStr<'static>,
        caller: &ToolCaller,
        _session: Option<uuid::Uuid>,
        request: ExecuteRequest,
        inputs: Option<Unattended>,
        _cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((caller.clone(), request.source, inputs));
        Ok(UserExecutionReceipt {
            status: ExecutionStatus::Succeeded,
            activity: Vec::new(),
            activity_truncated: false,
            result: Some(json!({"data": 1})),
            error: None,
        })
    }
}

struct Fixture {
    sources: Arc<Sources>,
    toolchain: Arc<Toolchain>,
    runs: Arc<Runs>,
    service: DocumentPrograms,
}

fn fixture(page: &str) -> Fixture {
    let sources = Arc::new(Sources(Mutex::new(page.to_owned())));
    let toolchain = Arc::new(Toolchain::default());
    let runs = Arc::new(Runs::default());
    let service = DocumentPrograms::new(
        sources.clone(),
        toolchain.clone(),
        toolchain.clone(),
        runs.clone(),
    );
    Fixture {
        sources,
        toolchain,
        runs,
        service,
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}

fn document() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        "0190f2a4-0000-7000-8000-000000000001",
        EntityType::Document,
    )
}

fn run_request(source_hash: SourceHash, program: &str) -> RunProgram {
    RunProgram {
        source_hash,
        program: ProgramId::try_new(program.to_owned()).unwrap(),
        arguments: serde_json::Map::from_iter([("query".to_owned(), json!("launch"))]),
        timeout_ms: 5_000,
    }
}

#[tokio::test]
async fn builds_each_source_once() {
    let fixture = fixture(PAGE);

    let first = fixture.service.build(&document()).await.unwrap();
    let second = fixture.service.build(&document()).await.unwrap();

    assert_eq!(first.source_hash, SourceHash::of(PAGE));
    assert_eq!(second.source_hash, first.source_hash);
    assert!(Arc::ptr_eq(&first.outcome, &second.outcome));
    assert_eq!(fixture.toolchain.checks.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn runs_the_built_program_as_the_document_caller_with_its_arguments() {
    let fixture = fixture(PAGE);
    let page = fixture.service.build(&document()).await.unwrap();

    let receipt = fixture
        .service
        .run(
            &user(),
            &document(),
            run_request(page.source_hash, "tasks"),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.result, Some(json!({"data": 1})));
    let runs = fixture.runs.0.lock().unwrap();
    let (caller, source, inputs) = &runs[0];
    assert_eq!(caller, &ToolCaller::Document);
    assert_eq!(source, "bundle:export default async () => 1;");
    let inputs = inputs.as_ref().unwrap();
    assert_eq!(inputs.arguments["query"], json!("launch"));
    assert!(!inputs.dry_run);
}

#[tokio::test]
async fn refuses_a_run_after_the_document_changed() {
    let fixture = fixture(PAGE);
    let page = fixture.service.build(&document()).await.unwrap();
    *fixture.sources.0.lock().unwrap() = PAGE.replace("=> 1", "=> 2");

    let Err(error) = fixture
        .service
        .run(
            &user(),
            &document(),
            run_request(page.source_hash, "tasks"),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("the run must be refused");
    };

    assert!(matches!(error, DocumentProgramError::Changed), "{error:?}");
    assert!(fixture.runs.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_an_unknown_program_and_a_document_that_does_not_build() {
    let fixture = fixture(PAGE);
    let page = fixture.service.build(&document()).await.unwrap();
    let Err(unknown) = fixture
        .service
        .run(
            &user(),
            &document(),
            run_request(page.source_hash, "other"),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("the run must be refused");
    };
    assert!(
        matches!(unknown, DocumentProgramError::UnknownProgram),
        "{unknown:?}"
    );

    let broken = PAGE.replace("=> 1", "=> broken");
    let fixture = self::fixture(&broken);
    let Err(failed) = fixture
        .service
        .run(
            &user(),
            &document(),
            run_request(SourceHash::of(&broken), "tasks"),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("the run must be refused");
    };
    assert!(
        matches!(failed, DocumentProgramError::BuildFailed),
        "{failed:?}"
    );
    assert!(fixture.runs.0.lock().unwrap().is_empty());
}
