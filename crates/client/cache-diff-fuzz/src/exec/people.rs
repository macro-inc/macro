//! The people ops: contact reconciliation, people context, people search and
//! reference resolution.

use super::{Exec, Outcome};
use cache_core::people::{ContextAction, ContextUpdate};
use serde_json::{Value, json};

impl Exec<'_> {
    pub(super) async fn contact_reconcile(&mut self, keep_every: u8) -> Outcome {
        let scope = self.scope(false).await?;
        let handle = self.handle();
        let snapshot = handle
            .contact_snapshot(
                serde_json::from_value(json!({
                    "scope": scope,
                    "scan": { "after": null, "limit": 200 },
                }))
                .map_err(|error| error.to_string())?,
            )
            .await?;
        let snapshot = serde_json::to_value(snapshot).map_err(|error| error.to_string())?;
        let ids: Vec<Value> = snapshot["ids"].as_array().cloned().unwrap_or_default();
        let present: Vec<Value> = ids
            .iter()
            .enumerate()
            .filter(|(index, _)| index % usize::from(keep_every.max(1)) == 0)
            .map(|(_, id)| id.clone())
            .collect();
        let reconcile = handle
            .contact_reconcile(
                serde_json::from_value(json!({
                    "scope": scope,
                    "fence": snapshot["fence"],
                    "viewer": self.identity,
                    "requested": ids,
                    "present": present,
                }))
                .map_err(|error| error.to_string())?,
            )
            .await;
        let reconcile = match reconcile {
            Ok(result) => serde_json::to_value(result).map_err(|error| error.to_string())?,
            Err(error) => json!({ "error": error }),
        };
        Ok(json!({ "snapshot": snapshot, "reconcile": reconcile }))
    }

    pub(super) async fn people_context(&mut self, epoch: &str) -> Outcome {
        let scope = self.scope(false).await?;
        let handle = self.handle();
        let state = handle.people_context(scope.clone()).await?;
        let epoch = epoch
            .parse()
            .map_err(|error: uuid::Error| error.to_string())?;
        let begin = handle
            .people_update(ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Begin {
                    previous_epoch: state.epoch(),
                },
            })
            .await
            .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));
        let commit = handle
            .people_update(ContextUpdate {
                scope,
                epoch,
                action: ContextAction::Commit,
            })
            .await
            .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));
        let wrap = |result: Result<Value, String>| {
            result.unwrap_or_else(|error| json!({ "error": error }))
        };
        Ok(json!({
            "before": serde_json::to_value(&state).map_err(|error| error.to_string())?,
            "begin": wrap(begin),
            "commit": wrap(commit),
        }))
    }

    pub(super) async fn people_search(&mut self, request: &Value, pages: u8) -> Outcome {
        let scope = self.scope(false).await?;
        let mut request = request.clone();
        request["scope"] = serde_json::to_value(&scope).map_err(|error| error.to_string())?;
        let mut out = Vec::new();
        for _ in 0..pages {
            let parsed: cache_core::people::PeopleSearch = serde_json::from_value(request.clone())
                .map_err(|error| format!("request: {error}"))?;
            let value = match self.handle().people_search(parsed).await {
                Ok(result) => serde_json::to_value(result).map_err(|error| error.to_string())?,
                Err(error) => {
                    out.push(json!({ "error": error }));
                    break;
                }
            };
            let kind = value["kind"].as_str().unwrap_or("?").to_owned();
            self.count(format!("people-search.{kind}"));
            let next = value["nextCursor"].clone();
            out.push(value);
            if next.is_null() {
                break;
            }
            request["cursor"] = next;
        }
        Ok(Value::Array(out))
    }

    pub(super) async fn people_references(&mut self, request: &Value) -> Outcome {
        let scope = self.scope(false).await?;
        let mut request = request.clone();
        request["scope"] = serde_json::to_value(&scope).map_err(|error| error.to_string())?;
        let parsed: cache_core::people::PeopleReferenceRequest =
            serde_json::from_value(request).map_err(|error| format!("request: {error}"))?;
        match self.handle().people_resolve_references(parsed).await {
            Ok(result) => {
                let value = serde_json::to_value(result).map_err(|error| error.to_string())?;
                let kind = value["kind"].as_str().unwrap_or("?").to_owned();
                self.count(format!("people-references.{kind}"));
                Ok(value)
            }
            Err(error) => Ok(json!({ "error": error })),
        }
    }
}
