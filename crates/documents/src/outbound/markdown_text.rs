//! Live document Markdown through the existing lexical exporter.
use crate::domain::{models::DocumentError, text::LiveMarkdownReader};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};

impl LiveMarkdownReader for LexicalClient {
    async fn markdown(&self, document_id: &str) -> Result<String, DocumentError> {
        self.get_markdown(document_id, MarkdownTarget::External)
            .await
            .map_err(DocumentError::Internal)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use lexical_client::test_utils::{FakeLexical, HELLO_DOCUMENT};

    #[tokio::test]
    async fn live_markdown_uses_the_selected_route_in_every_mode() {
        for mode in ["http", "in_process", "shadow"] {
            let backend = FakeLexical::new(
                HELLO_DOCUMENT,
                vec![(
                    "GET",
                    "/markdown/document-test?target=external",
                    serde_json::json!({"data":"Hello"}),
                )],
            )
            .await;
            let client = backend.client(&format!("markdown={mode}"));
            assert_eq!(
                LiveMarkdownReader::markdown(&client, "document-test")
                    .await
                    .unwrap(),
                "Hello"
            );
            assert_eq!(backend.requests().len(), usize::from(mode != "in_process"));
            assert_eq!(backend.raw_reads(), usize::from(mode != "http"));
        }
    }
}

#[cfg(test)]
mod local_stack_test {
    use super::*;
    use crate::domain::ports::markdown::MarkdownInitializationPort;
    use crate::outbound::markdown_init::LexicalSyncMarkdownInitializer;
    use lexical_client::test_utils::{LocalStack, trace_local};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires explicitly configured isolated local stack and OTLP collector"]
    async fn local_stack_document_snapshot_and_live_export() -> anyhow::Result<()> {
        let stack = LocalStack::load()?;
        let id = uuid::Uuid::now_v7().to_string();
        let initializer = LexicalSyncMarkdownInitializer::new(stack.lexical.clone(), stack.sync);
        let (_, trace_id) = trace_local("documents.initialize_and_read", async {
            let snapshot = initializer
                .initialize_existing_markdown(&id, "# Route check\n\n- one\n- two")
                .await?;
            assert!(!snapshot.is_empty());
            let markdown = LiveMarkdownReader::markdown(&stack.lexical, &id).await?;
            assert_eq!(markdown, "# Route check\n\n- one\n- two");
            Ok(())
        })
        .await?;
        println!("document local Tempo trace: {trace_id}");
        Ok(())
    }
}
