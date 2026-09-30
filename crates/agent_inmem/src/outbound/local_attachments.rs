//! Materialize local static-file images before invoking a remote model.
//!
//! Browser-facing local URLs cannot be fetched by model providers. This
//! adapter resolves only the configured static-file route through its owning
//! attachment service; other URLs retain their ordinary provider behavior.

use std::sync::Arc;

use agent::{AgentError, StreamPart};
use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentPart, AttachmentService, Attachments};
use futures::future::BoxFuture;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::Owner;
use non_empty::NonEmpty;
use tokio::sync::mpsc;
use tracing::Instrument as _;
use url::Url;

use crate::domain::engine::{TurnEngine, TurnRequest};

#[cfg(test)]
mod test;

/// A local deployment's turn engine, with private static-file images inlined.
///
/// The composition root supplies the browser-facing base URL and an attachment
/// service that can read the files internally. Resolution covers the whole
/// conversation, including prompts replayed after a process restart.
pub struct LocalAttachmentTurnEngine<S> {
    inner: Arc<dyn TurnEngine>,
    resolver: Arc<LocalImageResolver<S>>,
}

impl<S> LocalAttachmentTurnEngine<S> {
    /// Wrap `inner`, resolving images under `{public_base_url}/file/{uuid}`.
    ///
    /// The base must be an HTTP(S) URL without credentials, query or fragment.
    /// Configure this wrapper only where that origin is private to the local
    /// stack. Production URLs should continue directly to the model provider.
    pub fn new(
        inner: Arc<dyn TurnEngine>,
        mut public_base_url: Url,
        service: S,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            matches!(public_base_url.scheme(), "http" | "https")
                && public_base_url.host_str().is_some()
                && public_base_url.username().is_empty()
                && public_base_url.password().is_none()
                && public_base_url.query().is_none()
                && public_base_url.fragment().is_none(),
            "local static-file base must be an HTTP(S) URL without credentials, query or fragment"
        );
        public_base_url.set_path(&format!(
            "{}/file/",
            public_base_url.path().trim_end_matches('/')
        ));
        Ok(Self {
            inner,
            resolver: Arc::new(LocalImageResolver {
                file_base_url: public_base_url,
                service,
            }),
        })
    }
}

impl<S: AttachmentService> TurnEngine for LocalAttachmentTurnEngine<S> {
    fn supported_models(&self) -> &[&str] {
        self.inner.supported_models()
    }

    fn run_turn(&self, mut request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(256);
        let resolver = Arc::clone(&self.resolver);
        let inner = Arc::clone(&self.inner);
        let cancel = request.cancel.clone();
        tokio::spawn(
            async move {
                let turn = async {
                    // Before the engine starts, cancellation drops an in-flight
                    // attachment read without spending a model request.
                    let resolution = tokio::select! {
                        biased;
                        () = cancel.cancelled() => return,
                        result = resolver.resolve_request(&mut request) => result,
                    };
                    if let Err(error) = resolution {
                        let _ = parts.send(Err(AgentError::Other(error))).await;
                        return;
                    }
                    // The running engine owns cooperative cancellation. Drain
                    // its final tool results even after the token is cancelled.
                    let mut stream = inner.run_turn(request);
                    while let Some(part) = stream.recv().await {
                        if parts.send(part).await.is_err() {
                            break;
                        }
                    }
                };
                tokio::select! {
                    biased;
                    () = parts.closed() => cancel.cancel(),
                    () = turn => {},
                }
            }
            .in_current_span(),
        );
        receiver
    }
}

struct LocalImageResolver<S> {
    file_base_url: Url,
    service: S,
}

impl<S> LocalImageResolver<S> {
    /// Accept only canonical file identifiers beneath the configured route.
    /// Comparing the original URL also rejects paths normalized by parsing,
    /// such as literal or encoded traversal and backslash separators.
    fn file_id(&self, uri: &str) -> Option<Uuid> {
        let url = Url::parse(uri).ok()?;
        if url.origin() != self.file_base_url.origin()
            || url.as_str() != uri
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return None;
        }
        let id = url.path().strip_prefix(self.file_base_url.path())?;
        let parsed = Uuid::parse_str(id).ok()?;
        (parsed.to_string() == id).then_some(parsed)
    }
}

impl<S: AttachmentService> LocalImageResolver<S> {
    async fn resolve_request(&self, request: &mut TurnRequest) -> anyhow::Result<()> {
        for message in &mut request.messages {
            let Some(attachments) = message.attachments.take() else {
                continue;
            };
            let mut contents = attachments.into_parts().into_inner();
            for content in contents.iter_mut().flatten() {
                self.resolve_content(&request.owner, content).await?;
            }
            message.attachments = Some(Attachments::new(
                NonEmpty::new(contents).expect("resolving images preserves attachment count"),
            ));
        }
        Ok(())
    }

    fn resolve_content<'a>(
        &'a self,
        owner: &'a Owner,
        content: &'a mut AttachmentContent<'static>,
    ) -> BoxFuture<'a, anyhow::Result<()>> {
        Box::pin(async move {
            for index in 0..content.content.len() {
                match content.content.get_mut(index).expect("index is in bounds") {
                    AttachmentPart::Image(image) => {
                        if let ImageData::StaticUrl(uri) = image
                            && let Some(file_id) = self.file_id(uri)
                        {
                            *image = self.resolve_image(owner, file_id).await?;
                        }
                    }
                    AttachmentPart::Child(child) => {
                        if let Ok(child) = child.as_mut() {
                            self.resolve_content(owner, child).await?;
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        })
    }

    async fn resolve_image(&self, owner: &Owner, file_id: Uuid) -> anyhow::Result<ImageData> {
        let user = owner.as_user().ok_or_else(|| {
            anyhow::anyhow!("local image attachments require a user session owner")
        })?;
        let entity = EntityType::StaticFile.with_entity_string(file_id.to_string());
        let entities = [&entity];
        let resolved = self
            .service
            .resolve_attachments(
                user.clone(),
                NonEmpty::new(entities.as_slice()).expect("one image reference"),
            )
            .await;
        let mut contents = resolved.into_parts().into_inner();
        anyhow::ensure!(
            contents.len() == 1,
            "local image resolution returned multiple files"
        );
        let content = contents
            .pop()
            .expect("one resolved file")
            .map_err(|error| {
                anyhow::anyhow!("could not read local image attachment: {}", error.error)
            })?;
        let mut parts = content.content.into_inner();
        anyhow::ensure!(
            parts.len() == 1,
            "local image resolution returned multiple parts"
        );
        match parts.pop().expect("one resolved part") {
            AttachmentPart::Image(image @ ImageData::Base64(_)) => Ok(image),
            _ => anyhow::bail!("local image resolution did not return inline image content"),
        }
    }
}
