//! Application download APIs, separate from raw live state and sync projection.
use crate::*;

#[wasm_bindgen]
impl EditorSession {
    /// Raw live editor JSON, including local UI state.
    #[wasm_bindgen(js_name=serializedState)]
    pub fn serialized_state(&self) -> Result<String, JsError> {
        serde_json::to_string(
            &self
                .surface()
                .state()
                .to_json()
                .map_err(BoundaryError::from)
                .map_err(js)?,
        )
        .map_err(BoundaryError::from)
        .map_err(js)
    }
    /// Download-safe Macro JSON with regenerated search text and transient nodes removed.
    #[wasm_bindgen(js_name=savedState)]
    pub fn saved_state(&self) -> Result<String, JsError> {
        query::saved_state(self).map_err(js)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use doc_sync_core::*;
    use lexical_model::*;

    #[test]
    fn macro_bulk_export_uses_external_custom_nodes_and_download_projection()
    -> Result<(), BoundaryError> {
        let config = wire::SessionConfigMsg {
            doc: "query-fixture".into(),
            session: "00000000-0000-0000-0000-000000000001".into(),
            user: "fixture-user".into(),
            peers: vec![7, 8, 9],
            access: wire::Access::Edit,
            transport: wire::Transport::None,
            durable: false,
            chatter: false,
            headless: false,
            view_engine: 1,
            view_os: 0,
            token: String::new(),
            traceparent: String::new(),
            coalesce: 25,
            snapshot_interval: 0,
            observed: vec![],
        };
        let mut machine =
            machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
        machine.sync(SyncInput::Start, 0.0, None)?;
        machine.sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )?;
        machine.editor(Input::SetState {
            state:serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[
                {"type":"paragraph","$":{"id":"paragraph","searchText":"stale"},"children":[
                    {"type":"user-mention","userId":"fixture-user","displayName":"Display name"},
                    {"type":"text","text":" "},
                    {"type":"document-mention","documentId":"fixture-document","documentName":"Document","blockName":"md"}
                ]}
            ]}}))?,tags:TagSet::default()
        },2.0)?;
        let session = EditorSession {
            machine,
            hostname: Some("app.example.com".into()),
        };
        let before = session.surface().state().to_json()?;
        assert_eq!(
            query::markdown_for_session(&session, 1, false)?,
            r#"@Display name <m-document-mention>{"documentId":"fixture-document","blockName":"md","documentName":"Document","blockParams":{},"collapsed":false}</m-document-mention>"#
        );
        let internal = query::markdown_for_session(&session, 0, false)?;
        assert!(internal.contains("<m-user-mention>"));
        assert!(internal.contains("<m-document-mention>"));
        let saved: serde_json::Value = serde_json::from_str(&query::saved_state(&session)?)?;
        assert_ne!(saved["root"]["children"][0]["$"]["searchText"], "stale");
        assert_eq!(session.surface().state().to_json()?, before);
        Ok(())
    }
}
