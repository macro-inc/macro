//! Attio reads through the fixed tools of the user's connected Attio MCP
//! server.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_trait::async_trait;
use connectors::{ConnectorId, ConnectorKey, ConnectorsError, McpConnectionsService, McpHandle};
use connectors::{Sought, Status};
use import_tracker::outbound::connection::RequestPacer;
use macro_user_id::user_id::MacroUserIdStr;
use serde::de::DeserializeOwned;
use tracing::Instrument;

use crate::domain::{
    AttioConnections, AttioError, Company, CustomAttributes, Deal, Inventory, Member, Object,
    Person, ReadProgress, RecordId, Stage, Workspace,
};

mod wire;
use wire::{Answer, List, WireAttribute, WireMember, WireObject, WireRecord, WireSelf};

#[cfg(test)]
mod test;

/// Attio's catalog app, overlaid by its own MCP server.
const ATTIO_APP: &str = "attio";
/// Records asked for per `list-records` page.
const PAGE_LIMIT: u32 = 100;
/// Spacing between calls on one user's connection: about 10 a second, well
/// inside Attio's 100 reads a second per workspace.
const INTERVAL: Duration = Duration::from_millis(100);
/// Retries of a rate-limited call before the read gives up.
const RATE_LIMIT_RETRIES: u8 = 4;

/// Every tool call an import makes. Tool names are fixed and arguments are
/// built here, never taken from callers.
///
/// ASSUMED: Attio does not document its tools' argument names; these follow
/// its REST API's (`object`, `limit`, `offset`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttioRead {
    /// The workspace the connection reads.
    WhoAmI,
    /// The objects the workspace has turned on.
    ListObjects,
    /// One object's attribute definitions, with status options.
    ListAttributeDefinitions(Object),
    /// The workspace's members.
    ListWorkspaceMembers,
    /// One page of an object's records.
    ListRecords {
        /// The object.
        object: Object,
        /// Records asked for.
        limit: u32,
        /// Records skipped.
        offset: u32,
    },
}

impl AttioRead {
    /// The tool's name, as Attio's server lists it.
    pub fn tool(&self) -> &'static str {
        match self {
            Self::WhoAmI => "whoami",
            Self::ListObjects => "list-objects",
            Self::ListAttributeDefinitions(_) => "list-attribute-definitions",
            Self::ListWorkspaceMembers => "list-workspace-members",
            Self::ListRecords { .. } => "list-records",
        }
    }

    /// The call's arguments.
    pub fn arguments(&self) -> serde_json::Value {
        match self {
            Self::WhoAmI | Self::ListObjects | Self::ListWorkspaceMembers => {
                serde_json::json!({})
            }
            Self::ListAttributeDefinitions(object) => {
                serde_json::json!({ "object": object.slug() })
            }
            Self::ListRecords {
                object,
                limit,
                offset,
            } => serde_json::json!({
                "object": object.slug(),
                "limit": limit,
                "offset": offset,
            }),
        }
    }
}

/// Map a failed call through the connection.
fn map_error(tool: &'static str, error: ConnectorsError) -> AttioError {
    match error {
        ConnectorsError::NeedsReauth(_) => AttioError::NeedsReauth,
        ConnectorsError::ToolNotListed { .. } => AttioError::MissingTool(tool),
        // The connection went away between finding it and calling it.
        ConnectorsError::NotFound(_) => AttioError::NotConnected,
        ConnectorsError::TimedOut { .. } => AttioError::TimedOut(tool),
        error => AttioError::Transport(rootcause::Report::new(error).into_dynamic()),
    }
}

/// Opens Attio inventories through users' Attio MCP connections.
pub struct AttioMcp<S> {
    service: Arc<S>,
    pacers: Mutex<HashMap<MacroUserIdStr<'static>, Arc<RequestPacer>>>,
}

impl<S: McpConnectionsService> AttioMcp<S> {
    /// One call budget per user is shared by concurrent imports.
    pub fn new(service: Arc<S>) -> Self {
        Self {
            service,
            pacers: Mutex::default(),
        }
    }

    /// The user's Attio connections: the usable handle, or where they stand.
    async fn handle(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Result<McpHandle, Status>, AttioError> {
        let app = ConnectorId::parse(ATTIO_APP)
            .map_err(|error| AttioError::Transport(rootcause::Report::new(error).into_dynamic()))?;
        let connections = self
            .service
            .connections_to(user, Sought::App(&app))
            .await
            .map_err(|error| AttioError::Transport(rootcause::Report::new(error).into_dynamic()))?;
        let key = ConnectorKey::App(app);

        let handle = connections
            .handles()
            .find(|handle| *handle.key() == key)
            .cloned();
        Ok(handle.ok_or_else(|| connections.status(&key)))
    }

    fn pacer(&self, user: &MacroUserIdStr<'static>) -> Arc<RequestPacer> {
        self.pacers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(user.clone())
            .or_insert_with(|| Arc::new(RequestPacer::new(INTERVAL)))
            .clone()
    }
}

#[async_trait]
impl<S: McpConnectionsService> AttioConnections for AttioMcp<S> {
    #[tracing::instrument(name = "import.attio.connected", skip_all, err)]
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool, AttioError> {
        Ok(self.handle(user).await?.is_ok())
    }

    #[tracing::instrument(
        name = "import.attio.inventory",
        skip_all,
        fields(
            workspace_id = tracing::field::Empty,
            deals_active = tracing::field::Empty,
            companies = tracing::field::Empty,
            people = tracing::field::Empty,
            deals = tracing::field::Empty,
            members = tracing::field::Empty,
            stages = tracing::field::Empty,
            warnings = tracing::field::Empty,
        ),
        err
    )]
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, AttioError> {
        let handle = match self.handle(user).await? {
            Ok(handle) => handle,
            Err(Status::NeedsReauth) => return Err(AttioError::NeedsReauth),
            Err(_) => return Err(AttioError::NotConnected),
        };
        let mut read = Read {
            service: &*self.service,
            handle,
            pacer: self.pacer(user),
            warnings: Vec::new(),
        };
        let span = tracing::Span::current();

        let workspace: Workspace = read.call::<WireSelf>(AttioRead::WhoAmI).await?.into();
        span.record("workspace_id", tracing::field::display(workspace.id));

        let objects: List<WireObject> = read.call(AttioRead::ListObjects).await?;
        let deals_active = objects
            .data
            .iter()
            .any(|object| object.api_slug == Object::Deals.slug());
        span.record("deals_active", deals_active);
        if !deals_active {
            read.warnings.push(
                "Attio deals are not turned on in this workspace, so no deals or deal stages are read."
                    .into(),
            );
        }

        let members: List<WireMember> = read.call(AttioRead::ListWorkspaceMembers).await?;
        let members: Vec<Member> = members.data.into_iter().map(Member::from).collect();

        let objects: &[Object] = match deals_active {
            true => &[Object::Companies, Object::People, Object::Deals],
            false => &[Object::Companies, Object::People],
        };
        let mut custom_attributes = Vec::new();
        let mut stages = Vec::new();
        for object in objects {
            let (custom, object_stages) = read.attributes(*object).await?;
            custom_attributes.extend(custom);
            stages.extend(object_stages);
        }

        let mut counts = ReadProgress::default();
        let companies: Vec<Company> = read
            .records(Object::Companies, |count| {
                counts.companies = count;
                progress(counts);
            })
            .await?
            .into_iter()
            .map(|record| wire::company(record, &mut read.warnings))
            .collect();
        let people: Vec<Person> = read
            .records(Object::People, |count| {
                counts.people = count;
                progress(counts);
            })
            .await?
            .into_iter()
            .map(|record| wire::person(record, &mut read.warnings))
            .collect();
        let deals: Vec<Deal> = match deals_active {
            true => read
                .records(Object::Deals, |count| {
                    counts.deals = count;
                    progress(counts);
                })
                .await?
                .into_iter()
                .map(|record| wire::deal(record, &mut read.warnings))
                .collect(),
            false => Vec::new(),
        };

        span.record("companies", companies.len());
        span.record("people", people.len());
        span.record("deals", deals.len());
        span.record("members", members.len());
        span.record("stages", stages.len());
        span.record("warnings", read.warnings.len());
        Ok(Inventory {
            workspace,
            members,
            stages,
            companies,
            people,
            deals,
            custom_attributes,
            warnings: read.warnings,
        })
    }
}

/// One inventory read through one connection.
struct Read<'a, S> {
    service: &'a S,
    handle: McpHandle,
    pacer: Arc<RequestPacer>,
    /// Ids and fixed words only, never names, emails or domains.
    warnings: Vec<String>,
}

impl<S: McpConnectionsService> Read<'_, S> {
    /// Make one paced call, retrying a rate limit a bounded number of times,
    /// and decode its answer.
    async fn call<T: DeserializeOwned>(&self, read: AttioRead) -> Result<T, AttioError> {
        let tool = read.tool();
        let span =
            tracing::info_span!("import.attio.call", tool, attempts = tracing::field::Empty,);

        async {
            for attempt in 0..=RATE_LIMIT_RETRIES {
                self.pacer.wait().await;
                tracing::Span::current().record("attempts", attempt + 1);
                let result = self
                    .service
                    .call_tool(&self.handle, tool, read.arguments())
                    .await
                    .map_err(|error| map_error(tool, error))?;
                match wire::answer(tool, result)? {
                    Answer::Json(value) => return wire::decode(tool, value),
                    Answer::RateLimited => {
                        self.pacer.hold(Duration::from_secs(1 << attempt)).await;
                    }
                }
            }
            Err(AttioError::Unavailable)
        }
        .instrument(span)
        .await
    }

    /// An object's workspace-added attribute slugs and, for deals, the
    /// `stage` options.
    async fn attributes(
        &mut self,
        object: Object,
    ) -> Result<(Option<CustomAttributes>, Vec<Stage>), AttioError> {
        let read = AttioRead::ListAttributeDefinitions(object);
        let attributes: List<WireAttribute> = self.call(read).await?;

        let mut slugs = Vec::new();
        let mut stage = None;
        for attribute in attributes.data {
            if object == Object::Deals && attribute.is_stage() {
                stage = Some(attribute);
            } else if !attribute.is_system_attribute {
                slugs.push(attribute.api_slug);
            }
        }
        slugs.sort();

        let stages = match (object, stage) {
            (Object::Deals, Some(stage)) => stage.stages(read.tool())?,
            (Object::Deals, None) => {
                self.warnings.push(
                    "Attio deals have no stage attribute, so deals are read without stages.".into(),
                );
                Vec::new()
            }
            _ => Vec::new(),
        };
        let custom = (!slugs.is_empty()).then_some(CustomAttributes { object, slugs });
        Ok((custom, stages))
    }

    /// Every record of one object, page by page until an empty page.
    ///
    /// A short page is not taken as the end: a server may cap pages below
    /// the limit asked for (unknown for Attio's), so only an empty page
    /// proves it. A page repeating a record already read fails the read,
    /// so an ignored offset cannot loop or duplicate.
    async fn records(
        &self,
        object: Object,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<WireRecord>, AttioError> {
        let span = tracing::info_span!(
            "import.attio.records",
            object = object.slug(),
            pages = tracing::field::Empty,
            records = tracing::field::Empty,
        );

        async {
            let mut records = Vec::new();
            let mut seen: HashSet<RecordId> = HashSet::new();
            let mut offset: u32 = 0;
            let mut pages: u32 = 0;
            loop {
                let read = AttioRead::ListRecords {
                    object,
                    limit: PAGE_LIMIT,
                    offset,
                };
                let page: List<WireRecord> = self.call(read).await?;
                wire::check_page(read.tool(), object, &page.data)?;
                pages += 1;
                if page.data.is_empty() {
                    break;
                }

                let received = page.data.len();
                for record in page.data {
                    if !seen.insert(record.id()) {
                        return Err(AttioError::Decode(format!(
                            "Attio's {} answer repeated a {} record already read",
                            read.tool(),
                            object.singular()
                        )));
                    }
                    records.push(record);
                }
                progress(records.len());

                offset = u32::try_from(received)
                    .ok()
                    .and_then(|received| offset.checked_add(received))
                    .ok_or_else(|| {
                        AttioError::Decode(format!("Attio holds too many {object} to page through"))
                    })?;
            }

            let span = tracing::Span::current();
            span.record("pages", pages);
            span.record("records", records.len());
            Ok(records)
        }
        .instrument(span)
        .await
    }
}
