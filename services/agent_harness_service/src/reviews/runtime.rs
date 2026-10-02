//! Correlated workspace requests on the existing runtime bus. Large replies use S3.

use agent_harness::{
    inbound::runtime_gateway::GatewaySender,
    outbound::{forward::COMMAND_CHANNEL, runtime_registry::RuntimeRegistry},
};
use agent_review::domain::model::{Capture, Comparison, Result, ReviewError};
use agent_runtime_protocol::domain::schema::v0::ReviewCaptureResult;
use aws_sdk_s3::{Client, primitives::ByteStream};
use harness_id::HarnessId;
use redis::AsyncCommands;
use std::{sync::Arc, time::Duration};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Small control events on the existing Redis bus, not source-code payloads.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ReviewRuntimeEvent {
    CaptureReview {
        request: Uuid,
        harness: HarnessId,
        workspace: String,
        comparison: Comparison,
    },
    ReviewCaptured {
        request: Uuid,
        error: Option<String>,
    },
}

/// A capture requester and the listener on every harness replica.
#[derive(Clone)]
pub(crate) struct ReviewRuntimeBus {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    redis: redis::Client,
    s3: Client,
    bucket: String,
    answers: broadcast::Sender<(Uuid, Option<String>)>,
}

impl ReviewRuntimeBus {
    pub(crate) fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        redis: redis::Client,
        s3: Client,
        bucket: String,
    ) -> Self {
        Self {
            runtimes,
            redis,
            s3,
            bucket,
            answers: broadcast::channel(128).0,
        }
    }

    fn key(request: Uuid) -> String {
        format!("review-captures/{request}.json")
    }

    async fn publish(&self, event: ReviewRuntimeEvent) -> Result<()> {
        let payload = serde_json::to_string(&event)
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        self.redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
            .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }

    pub(crate) async fn observe(&self, event: ReviewRuntimeEvent) -> Result<()> {
        match event {
            ReviewRuntimeEvent::ReviewCaptured { request, error } => {
                let _ = self.answers.send((request, error));
            }
            ReviewRuntimeEvent::CaptureReview {
                request,
                harness,
                workspace,
                comparison,
            } => {
                if !self.runtimes.is_connected(harness) {
                    return Ok(());
                }
                let claimed: Option<String> = self
                    .redis
                    .get_multiplexed_async_connection()
                    .await
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
                    .set_options(
                        format!("agent-harness.review.claim.{request}"),
                        "claimed",
                        redis::SetOptions::default()
                            .conditional_set(redis::ExistenceCheck::NX)
                            .with_expiration(redis::SetExpiry::EX(180)),
                    )
                    .await
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
                if claimed.is_none() {
                    return Ok(());
                }
                let Some(response) = self
                    .runtimes
                    .capture_review(harness, workspace, comparison.base, comparison.head)
                    .await
                else {
                    return Ok(());
                };
                let result = match response {
                    Ok(ReviewCaptureResult::Available { capture }) => {
                        let bytes = serde_json::to_vec(&capture).map_err(|e| {
                            ReviewError::Infrastructure(rootcause::report!(e).into())
                        })?;
                        self.s3
                            .put_object()
                            .bucket(&self.bucket)
                            .key(Self::key(request))
                            .body(ByteStream::from(bytes))
                            .send()
                            .await
                            .map(|_| ())
                            .map_err(|_| "Could not store workspace capture".to_owned())
                    }
                    Ok(ReviewCaptureResult::Error { message }) => Err(message),
                    Err(error) => Err(error.to_string()),
                };
                self.publish(ReviewRuntimeEvent::ReviewCaptured {
                    request,
                    error: result.err(),
                })
                .await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn capture(
        &self,
        harness: HarnessId,
        workspace: &str,
        comparison: &Comparison,
    ) -> Result<Capture> {
        let request = Uuid::now_v7();
        let mut answers = self.answers.subscribe();
        self.publish(ReviewRuntimeEvent::CaptureReview {
            request,
            harness,
            workspace: workspace.into(),
            comparison: comparison.clone(),
        })
        .await?;
        // A persisted harness binding outlives its connection. A connected
        // replica claims the request before beginning capture; do not spend the
        // entire capture deadline waiting for an offline daemon.
        let connection = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        wait_for_owner(
            || async {
                connection
                    .clone()
                    .exists::<_, bool>(format!("agent-harness.review.claim.{request}"))
                    .await
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))
            },
            Duration::from_secs(3),
        )
        .await?;
        let response = tokio::time::timeout(Duration::from_secs(125), async {
            loop {
                let (id, error) = answers
                    .recv()
                    .await
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
                if id == request {
                    return match error {
                        Some(message) => Err(ReviewError::Unavailable(message)),
                        None => Ok(()),
                    };
                }
            }
        })
        .await
        .map_err(|_| {
            ReviewError::Unavailable(
                "Workspace capture timed out; check that macrod is connected and up to date".into(),
            )
        })?;
        response?;
        let object = self
            .s3
            .get_object()
            .bucket(&self.bucket)
            .key(Self::key(request))
            .send()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        let bytes = object
            .body
            .collect()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
            .into_bytes();
        let capture = serde_json::from_slice(&bytes)
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        if let Err(error) = self
            .s3
            .delete_object()
            .bucket(&self.bucket)
            .key(Self::key(request))
            .send()
            .await
        {
            tracing::warn!(?error, "temporary review capture cleanup failed");
        }
        Ok(capture)
    }
}

// Kept separate so offline routing is tested without a daemon or an S3 client.
async fn wait_for_owner<F, T>(mut claimed: F, timeout: Duration) -> Result<()>
where
    F: FnMut() -> T,
    T: std::future::Future<Output = Result<bool>>,
{
    tokio::time::timeout(timeout, async {
        loop {
            if claimed().await? {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .map_err(|_| {
        ReviewError::Unavailable(
            "Workspace runtime is offline; connect macrod or review the linked pull request".into(),
        )
    })?
}

#[cfg(test)]
mod test {
    use super::*;
    #[tokio::test]
    async fn offline_binding_leaves_the_pr_fallback_its_capture_budget() {
        let start = std::time::Instant::now();
        let result = wait_for_owner(|| async { Ok(false) }, Duration::from_millis(20)).await;
        assert!(matches!(result, Err(ReviewError::Unavailable(_))));
        assert!(start.elapsed() < Duration::from_secs(1));
        wait_for_owner(|| async { Ok(true) }, Duration::from_millis(20))
            .await
            .unwrap();
    }
}
