//! Soup service fixtures keep replica reads distinct from primary mutation replies.

use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use graphql_soup::{SoupInboxReader, SoupItemDataLoader, SoupItemLoader, SoupItemLoaderError};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use models_pagination::{Paginated, PaginatedCursor, SimpleSortMethod};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::{initiative::SoupInitiative, item::SoupItem};
use soup::domain::{
    models::{
        EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, SoupErr, SoupPropertiesField,
        SoupRequest, grouping::ItemGroupingInfo,
    },
    ports::{SoupOutput, SoupService},
};
use uuid::Uuid;

use super::{RecordingApi, detail, user};

pub(super) const VIEWED_AT: &str = "2026-09-20T12:00:00+00:00";

#[derive(Clone)]
pub(super) struct RecordingSoupService {
    pub(super) calls: Arc<Mutex<Vec<String>>>,
    source: Source,
}

#[derive(Clone)]
enum Source {
    Replica,
    Empty,
    Primary(Arc<RecordingApi>),
}

impl RecordingSoupService {
    pub(super) fn replica() -> Self {
        Self {
            calls: Arc::default(),
            source: Source::Replica,
        }
    }

    pub(super) fn empty() -> Self {
        Self {
            calls: Arc::default(),
            source: Source::Empty,
        }
    }

    pub(super) fn primary(api: Arc<RecordingApi>) -> Self {
        Self {
            calls: Arc::default(),
            source: Source::Primary(api),
        }
    }

    pub(super) fn loader(&self) -> SoupItemDataLoader {
        SoupItemDataLoader::new(SoupItemLoader::new(self.clone(), NoInboxes))
    }
}

impl SoupService for RecordingSoupService {
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        assert!(team_receipt.is_none());
        self.calls.lock().unwrap().push(req.user.to_string());
        let snapshot = match &self.source {
            Source::Replica => Some(detail()),
            Source::Empty => None,
            Source::Primary(api) => Some(api.current_detail()),
        };
        let items = snapshot
            .filter(|_| req.user == user())
            .map(|detail| {
                SoupItem::Initiative(SoupInitiative {
                    id: detail.id.as_uuid(),
                    name: detail.name,
                    owner_id: Owner::from_principal_str(detail.owner_id.as_ref()).unwrap(),
                    created_at: detail.created_at,
                    updated_at: detail.updated_at,
                    viewed_at: Some(
                        DateTime::parse_from_rfc3339(VIEWED_AT)
                            .unwrap()
                            .with_timezone(&Utc),
                    ),
                    extra: (),
                })
            })
            .into_iter()
            .collect();
        let page: PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> =
            Paginated::from_parts(items, None);
        Ok(SoupOutput::Simple(page))
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("initiative hydration uses raw Soup")
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("initiative hydration uses raw Soup")
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("initiative hydration uses raw Soup")
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        unreachable!("initiative hydration uses raw Soup");
        #[expect(
            unreachable_code,
            reason = "the unreachable stub still needs a concrete iterator type"
        )]
        Ok(Vec::<ItemGroupingInfo<SoupPropertiesField>>::new().into_iter())
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        unreachable!("initiative hydration does not read tag definitions")
    }
}

struct NoInboxes;

impl SoupInboxReader for NoInboxes {
    async fn get_inbox_ids(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Uuid>, SoupItemLoaderError> {
        unreachable!("initiative hydration must not request email inboxes")
    }
}
