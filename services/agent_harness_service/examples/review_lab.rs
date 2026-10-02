//! Loopback-only browser/MCP lab using real capture and review policy with ephemeral storage.
//! Run with a disposable public checkout and base SHA. Never connect this to hosted data.
use agent_review::{
    domain::{
        model::*,
        ports::ReviewSource,
        service::{ReviewService, Reviews},
    },
    testing::{Fixture, editor, user},
};
use agent_session::domain::{
    model::AgentSessionId, ports::AgentSessionRepo, pull_request::SessionPullRequestService,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use std::{path::PathBuf, sync::Arc};
#[path = "../src/internal_mcp.rs"]
mod internal_mcp;

struct Workspace {
    capture: agent_review_runtime::WorkspaceCapture,
    path: PathBuf,
    base: String,
}
#[async_trait::async_trait]
impl ReviewSource for Workspace {
    async fn capture(
        &self,
        _: &agent_session::domain::model::AgentSession,
        comparison: &Comparison,
    ) -> Result<Capture> {
        let capture = self
            .capture
            .capture(
                self.path.clone(),
                agent_review_runtime::Comparison {
                    base: comparison.base.clone().or(Some(self.base.clone())),
                    head: comparison.head.clone(),
                },
            )
            .await
            .map_err(ReviewError::Unavailable)?;
        Ok(Capture {
            comparison: Comparison {
                base: capture.comparison.base,
                head: capture.comparison.head,
                worktree: false,
            },
            repository: capture.repository,
            source: SourceKind::Workspace,
            snapshot: capture.snapshot,
        })
    }
}
#[derive(Clone)]
struct Lab {
    reviews: Arc<dyn Reviews>,
    feedback: Arc<agent_review::testing::RecordingFeedback>,
}
#[derive(Deserialize)]
struct Selection {
    revision: u32,
    path: String,
}
#[derive(Deserialize)]
struct RevisionQuery {
    revision: Option<u32>,
}
#[derive(Deserialize)]
struct LinkRequest {
    revision: u32,
    location: Location,
}
#[derive(Deserialize)]
struct ResolveRequest {
    thread: uuid::Uuid,
    resolved: bool,
}
type HttpResult<T> = std::result::Result<Json<T>, (StatusCode, Json<serde_json::Value>)>;
fn response<T>(result: Result<T>) -> HttpResult<T> {
    result.map(Json).map_err(|e| {
        (
            match e {
                ReviewError::Conflict => StatusCode::CONFLICT,
                ReviewError::NotFound => StatusCode::NOT_FOUND,
                _ => StatusCode::BAD_REQUEST,
            },
            Json(serde_json::json!({"message":e.to_string()})),
        )
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 4,
        "review_lab <disposable checkout> <base SHA> <port>"
    );
    let path = PathBuf::from(&args[1]).canonicalize()?;
    let port: u16 = args[3].parse()?;
    let f = Fixture::new();
    f.sessions
        .set_egress_token_hash(
            AgentSessionId::TEST_A,
            &agent_egress::domain::model::SessionToken::new("review-lab-only").hash(),
        )
        .await?;
    let source = Arc::new(Workspace {
        capture: agent_review_runtime::WorkspaceCapture::new(path.clone()),
        path,
        base: args[2].clone(),
    });
    let reviews: Arc<dyn Reviews> = Arc::new(ReviewService::new(
        f.sessions.clone(),
        f.repo,
        f.bodies,
        source,
        f.feedback.clone(),
        Arc::new(agent_review::testing::NoEvents),
        "http://localhost:3004".parse()?,
    ));
    let worker = reviews.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            if let Err(error) = worker.deliver_pending().await {
                eprintln!("feedback: {error}");
            }
        }
    });
    let lab = Lab {
        reviews: reviews.clone(),
        feedback: f.feedback,
    };
    let routes =
        Router::new()
            .route(
                "/review",
                get(
                    |State(lab): State<Lab>, Query(q): Query<RevisionQuery>| async move {
                        response(
                            lab.reviews
                                .view(editor(), q.revision)
                                .await
                                .map(|review| serde_json::json!({"review":review})),
                        )
                    },
                ),
            )
            .route(
                "/review/file",
                get(
                    |State(lab): State<Lab>, Query(q): Query<Selection>| async move {
                        response(lab.reviews.file(editor(), q.revision, &q.path).await)
                    },
                ),
            )
            .route(
                "/review/capture",
                post(
                    |State(lab): State<Lab>, Json(q): Json<Comparison>| async move {
                        response(
                            lab.reviews
                                .capture(editor(), q, Presentation::default())
                                .await,
                        )
                    },
                ),
            )
            .route(
                "/review/comment",
                post(
                    |State(lab): State<Lab>, Json(q): Json<Comment>| async move {
                        response(lab.reviews.comment(editor(), q).await)
                    },
                ),
            )
            .route(
                "/review/link",
                post(
                    |State(lab): State<Lab>, Json(q): Json<LinkRequest>| async move {
                        response(lab.reviews.link(editor(), q.revision, q.location).await)
                    },
                ),
            )
            .route(
                "/review/resolve",
                post(
                    |State(lab): State<Lab>, Json(q): Json<ResolveRequest>| async move {
                        response(
                            lab.reviews
                                .resolve(editor(), q.thread, q.resolved)
                                .await
                                .map(|_| serde_json::json!({})),
                        )
                    },
                ),
            )
            .route(
                "/test/feedback",
                get(|State(lab): State<Lab>| async move {
                    Json(lab.feedback.0.lock().unwrap().clone())
                }),
            )
            .with_state(lab)
            .merge(internal_mcp::router(
                Arc::new(f.sessions.clone()),
                Arc::new(SessionPullRequestService::new(
                    f.sessions,
                    agent_session::testing::RecordingRealtime::new(),
                )),
                reviews,
                format!("localhost:{port}"),
            ));
    println!(
        "Review lab listening on http://localhost:{port}; session {}; user {}",
        AgentSessionId::TEST_A,
        user()
    );
    axum::serve(
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?,
        routes,
    )
    .await?;
    Ok(())
}
