//! `ImportFromFusion`: the agent's one tool for Autodesk Fusion imports.
//!
//! The user comes from the request context, so the model can never import
//! into another user's account.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::models::{
    ApsFolderId, ApsProjectId, BrowseAt, BrowseEntry, HubId, InvalidApsId, ItemId, SyncReport,
    SyncScope,
};
use crate::domain::service::{
    FUSION_IMPORT_OFF, FusionImport, FusionImportError, MAX_IMPORT_ITEMS, MAX_SYNC_ITEMS,
};

#[cfg(test)]
mod test;

/// Service context for the Fusion tool.
///
/// The service is optional because the tool schema ships with the shared
/// chat toolset while only hosts that can build the import wire it. Where it
/// is absent, calls fail with a clear error instead of not existing.
pub struct FusionToolContext<S> {
    /// The import, where the host wired one.
    pub service: Option<Arc<S>>,
}

impl<S> Clone for FusionToolContext<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<S> FusionToolContext<S> {
    /// A context backed by a real import.
    pub fn wired(service: Arc<S>) -> Self {
        Self {
            service: Some(service),
        }
    }

    /// A context with no import: every call fails with a clear error.
    pub fn unwired() -> Self {
        Self { service: None }
    }
}

/// The Fusion import toolset.
pub fn fusion_toolset<S: FusionImport>() -> AsyncToolCollection<FusionToolContext<S>> {
    AsyncToolCollection::new().add_tool::<ImportFromFusion, FusionToolContext<S>>()
}

/// What the tool is asked to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FusionAction {
    /// Show hubs, a hub's projects, a project's top folders, or a folder.
    Browse,
    /// Import chosen items of one project.
    Import,
    /// Import the versions of imported items that are not in Macro yet.
    Sync,
}

/// Browse, import or sync the user's Autodesk Fusion designs.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportFromFusion",
    description = "Import the user's Autodesk Fusion designs into Macro, with every version. Each Autodesk item (a design or file) becomes one Macro file document, and each of its Autodesk versions one version of that document, oldest first. It only reads Autodesk; it never changes anything there. `browse` walks the user's Autodesk data: with no ids it lists hubs; with `hubId` that hub's projects; with `hubId` and `projectId` the project's top folders; with `projectId` and `folderId` (and `cursor` for the next page) a folder's subfolders and items. Items already imported show their `documentId`. Show the user what is there and ask which designs to import. `import` takes `projectId` and 1 to 20 `itemIds` of that project. `sync` imports only versions not yet in Macro, for the `itemIds` given or for all the user's imported items. Each call downloads at most 10 versions and covers at most 50 items: while a report has a `nextCursor`, call `sync` again with it as `cursor`; while it has `remaining` or `notReached` above 0 for named items, call `sync` again with them. Never recreate these files with other tools."
)]
pub struct ImportFromFusion {
    /// What to do.
    pub action: FusionAction,
    /// For `browse`: the hub to list projects of, or the hub of `projectId`.
    #[serde(default)]
    pub hub_id: Option<String>,
    /// For `browse` and `import`: the project.
    #[serde(default)]
    pub project_id: Option<String>,
    /// For `browse`: the folder to list.
    #[serde(default)]
    pub folder_id: Option<String>,
    /// For `browse` of a folder, or `sync` of all imported items: where to
    /// continue, the previous answer's `nextCursor`.
    #[serde(default)]
    pub cursor: Option<String>,
    /// For `import`: 1 to 20 items of `projectId`. For `sync`: the items to
    /// sync, or none for all imported items.
    #[serde(default)]
    pub item_ids: Vec<String>,
}

/// The tool's answer.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ImportFromFusionResponse {
    /// What a browse found.
    #[serde(rename_all = "camelCase")]
    Browse {
        /// What is there.
        entries: Vec<BrowseEntry>,
        /// The `cursor` of the folder's next page, when there is one.
        next_cursor: Option<String>,
        /// What to do next.
        message: String,
    },
    /// What an import or sync did.
    Report {
        /// Per item, and the totals.
        report: SyncReport,
        /// What to do next.
        message: String,
    },
}

impl ToolAnnotated for ImportFromFusion {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Import from Autodesk Fusion").with_open_world();
}

/// A validated request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FusionRequest {
    Browse(BrowseAt),
    Import {
        project: ApsProjectId,
        items: Vec<ItemId>,
    },
    Sync(SyncScope),
}

fn refusal(description: String) -> ToolCallError {
    ToolCallError {
        internal_error: FusionImportError::InvalidRequest("invalid ImportFromFusion arguments")
            .into(),
        description,
    }
}

fn invalid_id(error: InvalidApsId) -> ToolCallError {
    refusal(format!("{error}. Use the ids `browse` returns."))
}

fn item_ids(raw: &[String]) -> ToolResult<Vec<ItemId>> {
    raw.iter()
        .map(|id| ItemId::parse(id.trim()).map_err(invalid_id))
        .collect()
}

impl ImportFromFusion {
    /// The folder page `cursor` names, from 0.
    fn folder_page(&self) -> ToolResult<u32> {
        match &self.cursor {
            None => Ok(0),
            Some(cursor) => cursor.trim().parse().map_err(|_| {
                refusal(format!(
                    "`{cursor}` is not a folder cursor; pass the `nextCursor` a browse returned."
                ))
            }),
        }
    }

    /// The request these arguments make, or what is wrong with them.
    pub(crate) fn request(&self) -> ToolResult<FusionRequest> {
        let parse_hub = |raw: &String| HubId::parse(raw.trim()).map_err(invalid_id);
        let parse_project = |raw: &String| ApsProjectId::parse(raw.trim()).map_err(invalid_id);

        match self.action {
            FusionAction::Browse => {
                if !self.item_ids.is_empty() {
                    return Err(refusal("`browse` takes no `itemIds`.".to_string()));
                }
                let at = match (&self.hub_id, &self.project_id, &self.folder_id) {
                    (None, None, None) => BrowseAt::Hubs,
                    (Some(hub), None, None) => BrowseAt::Projects {
                        hub: parse_hub(hub)?,
                    },
                    (Some(hub), Some(project), None) => BrowseAt::TopFolders {
                        hub: parse_hub(hub)?,
                        project: parse_project(project)?,
                    },
                    (_, Some(project), Some(folder)) => BrowseAt::Folder {
                        project: parse_project(project)?,
                        folder: ApsFolderId::parse(folder.trim()).map_err(invalid_id)?,
                        page: self.folder_page()?,
                    },
                    _ => {
                        return Err(refusal(
                            "`browse` takes nothing (hubs), `hubId` (its projects), `hubId` and `projectId` (top folders), or `projectId` and `folderId` (a folder).".to_string(),
                        ));
                    }
                };
                if self.cursor.is_some() && !matches!(at, BrowseAt::Folder { .. }) {
                    return Err(refusal("`cursor` pages a folder only.".to_string()));
                }
                Ok(FusionRequest::Browse(at))
            }
            FusionAction::Import => {
                let Some(project) = &self.project_id else {
                    return Err(refusal(
                        "`import` needs the items' `projectId`.".to_string(),
                    ));
                };
                if self.item_ids.is_empty() || self.item_ids.len() > MAX_IMPORT_ITEMS {
                    return Err(refusal(format!(
                        "`import` takes 1 to {MAX_IMPORT_ITEMS} `itemIds`; it got {}.",
                        self.item_ids.len()
                    )));
                }
                Ok(FusionRequest::Import {
                    project: parse_project(project)?,
                    items: item_ids(&self.item_ids)?,
                })
            }
            FusionAction::Sync => {
                if self.item_ids.len() > MAX_SYNC_ITEMS {
                    return Err(refusal(format!(
                        "`sync` takes at most {MAX_SYNC_ITEMS} `itemIds`; it got {}. Leave them out to sync everything imported.",
                        self.item_ids.len()
                    )));
                }
                let scope = match (self.item_ids.is_empty(), &self.cursor) {
                    (false, None) => SyncScope::Items(item_ids(&self.item_ids)?),
                    (true, None) => SyncScope::All { from: None },
                    (true, Some(cursor)) => SyncScope::All {
                        from: Some(ItemId::parse(cursor.trim()).map_err(invalid_id)?),
                    },
                    (false, Some(_)) => {
                        return Err(refusal(
                            "`cursor` continues a sync of all imported items; leave out `itemIds` with it.".to_string(),
                        ));
                    }
                };
                Ok(FusionRequest::Sync(scope))
            }
        }
    }
}

/// What the model should be told when a call fails as a whole.
fn call_error(error: FusionImportError) -> ToolCallError {
    let description = match &error {
        FusionImportError::NotFound(what) if *what == FUSION_IMPORT_OFF => {
            "Fusion import is not available for this user.".to_string()
        }
        FusionImportError::NotFound(what) => format!(
            "That {what} is not in the user's Autodesk account, or they can't open it. Browse again from the hubs."
        ),
        FusionImportError::NotConnected => "Autodesk is not connected, or the connection gives no file access. Ask the user to connect Autodesk (find it with DiscoverConnectors), then try again.".to_string(),
        FusionImportError::NeedsReauth => "The user's Autodesk connection has stopped working. Ask them to reconnect Autodesk in Settings, then try again.".to_string(),
        FusionImportError::InvalidRequest(reason) => format!("Invalid request: {reason}."),
        FusionImportError::RateLimited { .. } => "Autodesk is rate limiting requests. Wait a minute, then try again.".to_string(),
        FusionImportError::Upstream(_) => "Autodesk is unavailable right now. Try again later.".to_string(),
        FusionImportError::Internal(_) => "The Fusion import failed. Try again later.".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

/// What the model should know and do after an import or sync.
pub(crate) fn report_message(report: &SyncReport) -> String {
    let imported: u32 = report.items.iter().map(|item| item.imported_now).sum();
    let mut message = format!("Imported {imported} versions.");
    if let Some(cursor) = &report.next_cursor {
        message.push_str(&format!(
            " More to do: call `sync` again with `cursor` \"{}\" and no `itemIds`.",
            cursor.as_str()
        ));
    } else if report.remaining > 0 || report.not_reached > 0 {
        message.push_str(&format!(
            " {} versions remain and {} items were not reached; call `sync` again with the same `itemIds` to continue.",
            report.remaining, report.not_reached
        ));
    } else {
        message.push_str(" Every version found is recorded.");
    }
    let unidentified: usize = report.items.iter().map(|item| item.unidentified.len()).sum();
    if unidentified > 0 {
        message.push_str(&format!(
            " {unidentified} versions have a file type Autodesk did not name; they are not recorded, and a later sync tries them again."
        ));
    }
    message.push_str(" Items with status `busy`, `rate_limited` or `failed` can be synced again later; `document_gone` means the user deleted the document, and `import` makes a new one.");
    message
}

#[async_trait]
impl<S: FusionImport> AsyncTool<FusionToolContext<S>> for ImportFromFusion {
    type Output = ImportFromFusionResponse;

    #[tracing::instrument(skip_all, fields(action = ?self.action, items = self.item_ids.len()), err)]
    async fn call(
        &self,
        service_context: ServiceContext<FusionToolContext<S>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = service_context
            .service
            .as_ref()
            .ok_or_else(|| ToolCallError {
                description: "Fusion import is not available in this context.".to_string(),
                internal_error: FusionImportError::InvalidRequest(
                    "Fusion import is not wired into this host",
                )
                .into(),
            })?;
        let user = &request_context.user_id;

        match self.request()? {
            FusionRequest::Browse(at) => {
                let page = service.browse(user, at).await.map_err(call_error)?;
                let message = if page.entries.is_empty() {
                    "Nothing here.".to_string()
                } else {
                    "Show the user these and ask which designs to import. Items are imported with `import` and the `projectId` they were browsed in.".to_string()
                };
                Ok(ImportFromFusionResponse::Browse {
                    entries: page.entries,
                    next_cursor: page.next_cursor,
                    message,
                })
            }
            FusionRequest::Import { project, items } => {
                let report = service
                    .import(user, project, items)
                    .await
                    .map_err(call_error)?;
                let message = report_message(&report);
                Ok(ImportFromFusionResponse::Report { report, message })
            }
            FusionRequest::Sync(scope) => {
                let report = service.sync(user, scope).await.map_err(call_error)?;
                let message = report_message(&report);
                Ok(ImportFromFusionResponse::Report { report, message })
            }
        }
    }
}
