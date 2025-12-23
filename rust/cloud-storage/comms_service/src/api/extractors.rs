use axum::{
    RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use comms::{
    domain::{models::channel_name::resolve_channel_name, ports::ChannelsService},
    inbound::CommsRouterState,
};
use comms_db_client::{
    channels::get_channel_info::{ChannelInfo, get_channel_info},
    messages::get_message_owner::get_message_owner,
    participants::get_participants::get_participants,
};
use doppleganger::Mirror;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::{
    comms::ParticipantRole,
    user::{UserContext, axum_extractor::MacroUserExtractor},
};
use models_comms::channel::ChannelType;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{
    collections::{HashMap, HashSet},
    marker::PhantomData,
};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
pub struct ChannelName<T>(pub String, pub PhantomData<T>);

impl<T> Clone for ChannelName<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), PhantomData)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChannelId(pub Uuid);

#[derive(Deserialize, Clone, Debug)]
pub struct ChannelParticipants(pub Vec<models_comms::channel::ChannelParticipant>);

#[derive(Debug, Clone, Copy)]
pub struct ChannelTypeExtractor(pub ChannelType);

#[derive(Serialize, Deserialize, Clone, Debug, ToSchema)]
pub enum ParticipantAccess {
    Access { role: ParticipantRole },
    NoAccess,
}

pub async fn extract_path_uuid_by_name(parts: &mut Parts, name: &str) -> Result<Uuid, Response> {
    let Path(params): Path<HashMap<String, String>> = Path::from_request_parts(parts, &())
        .await
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid path parameters").into_response())?;

    let param_str = params.get(name).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("Missing {} parameter", name),
        )
            .into_response()
    })?;

    Uuid::parse_str(param_str).map_err(|err| {
        tracing::error!("Failed to parse {} as UUID: {}", name, err);
        (StatusCode::BAD_REQUEST, format!("Invalid {} format", name)).into_response()
    })
}

async fn extract_cached<T, S>(parts: &mut Parts, state: &S) -> Result<T, Response>
where
    T: 'static,
    Cached<T>: FromRequestParts<S>,
    S: Send + Sync,
{
    Cached::<T>::from_request_parts(parts, state)
        .await
        .map(|Cached(val)| val)
        .map_err(|e| e.into_response())
}

fn unauthorized(msg: &'static str) -> Response {
    (StatusCode::UNAUTHORIZED, msg).into_response()
}

#[async_trait]
impl<S> FromRequestParts<S> for ChannelId
where
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        const CHANNEL_ID: &str = "channel_id";
        let id = extract_path_uuid_by_name(parts, CHANNEL_ID).await?;
        Ok(ChannelId(id))
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for ChannelParticipants
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let Cached(ChannelId(channel_id)) =
            Cached::<ChannelId>::from_request_parts(parts, state).await?;

        let participants = get_participants(&db, &channel_id).await.map_err(|err| {
            tracing::error!(
                "Failed to get participants for channel {:?}: {}",
                channel_id,
                err
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get participants",
            )
                .into_response()
        })?;

        Ok(ChannelParticipants(participants))
    }
}

#[derive(Clone)]
pub struct ChannelInfoExtractor(pub ChannelInfo);

#[async_trait]
impl<S> FromRequestParts<S> for ChannelInfoExtractor
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let Cached(ChannelId(channel_id)) =
            Cached::<ChannelId>::from_request_parts(parts, &()).await?;

        let info = get_channel_info(&db, &channel_id).await.map_err(|err| {
            tracing::error!(error=?err, "unable to get channel info");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
        })?;

        Ok(ChannelInfoExtractor(info))
    }
}

#[async_trait]
impl<S, U> FromRequestParts<S> for ChannelName<U>
where
    S: Send + Sync,
    PgPool: FromRef<S>,
    CommsRouterState<U>: FromRef<S>,
    U: ChannelsService,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let ChannelId(channel_id) = extract_cached::<ChannelId, _>(parts, state).await?;
        let ChannelTypeExtractor(channel_type) =
            extract_cached::<ChannelTypeExtractor, _>(parts, state).await?;
        let ChannelParticipants(participants) =
            extract_cached::<ChannelParticipants, _>(parts, state).await?;
        let MacroUserExtractor { macro_user_id, .. } =
            parts.extract().await.map_err(IntoResponse::into_response)?;

        let ChannelInfoExtractor(ChannelInfo { name, .. }) =
            extract_cached::<ChannelInfoExtractor, _>(parts, state).await?;

        let user_ids = participants
            .iter()
            .map(|p| p.user_id.copied())
            .collect::<HashSet<_>>();

        let service = <CommsRouterState<U>>::from_ref(state);
        let name_lookup = service
            .inner
            .get_names(user_ids)
            .await
            .ok()
            .map(|names| {
                names
                    .into_iter()
                    .filter_map(|n| {
                        let display = n.display_name()?;
                        Some((n.id, display))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();

        let channel_name = resolve_channel_name(
            &channel_type,
            name.as_deref(),
            &participants,
            &models_comms::channel::ChannelId(channel_id),
            macro_user_id,
            &name_lookup,
        );

        return Ok(ChannelName(channel_name, PhantomData));
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for ChannelTypeExtractor
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let ChannelId(channel_id) = extract_cached::<ChannelId, _>(parts, state).await?;

        let info = get_channel_info(&db, &channel_id).await.map_err(|err| {
            tracing::error!(
                "Failed to get channel info for channel {:?}: {}",
                channel_id,
                err
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get channel info",
            )
                .into_response()
        })?;

        Ok(ChannelTypeExtractor(match info.channel_type {
            model::comms::ChannelType::Public => models_comms::channel::ChannelType::Public,
            model::comms::ChannelType::Organization => {
                models_comms::channel::ChannelType::Organization
            }
            model::comms::ChannelType::Private => models_comms::channel::ChannelType::Private,
            model::comms::ChannelType::DirectMessage => {
                models_comms::channel::ChannelType::DirectMessage
            }
        }))
    }
}

#[derive(Clone, Debug)]
pub struct UserContextWithRole {
    pub context: UserContext,
    pub user_id: MacroUserIdStr<'static>,
    pub role: Option<models_comms::channel::ParticipantRole>,
}

pub async fn get_user_role(
    user_context: &UserContext,
    info: &ChannelInfo,
    participants: &[models_comms::channel::ChannelParticipant],
) -> Option<models_comms::channel::ParticipantRole> {
    let user_participant = participants
        .iter()
        .find(|p| p.user_id.as_ref() == user_context.user_id);

    match info.channel_type {
        model::comms::ChannelType::Public => Some(
            user_participant
                .map(|p| p.role)
                .unwrap_or(models_comms::channel::ParticipantRole::Member),
        ),
        model::comms::ChannelType::Organization => {
            let org_match = user_context
                .organization_id
                .and_then(|user_org| info.org_id.map(|ch_org| ch_org == user_org as i64))
                .unwrap_or(false);

            if org_match {
                Some(
                    user_participant
                        .map(|p| p.role)
                        .unwrap_or(models_comms::channel::ParticipantRole::Member),
                )
            } else {
                user_participant.map(|p| p.role)
            }
        }
        _ => user_participant.map(|p| p.role),
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for UserContextWithRole
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Cached(ChannelId(channel_id)) =
            Cached::<ChannelId>::from_request_parts(parts, state).await?;

        let Cached(ChannelParticipants(participants)) =
            Cached::<ChannelParticipants>::from_request_parts(parts, state).await?;

        let MacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts.extract().await.map_err(IntoResponse::into_response)?;
        let info = get_channel_info(&PgPool::from_ref(state), &channel_id)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "Failed to get channel info for channel {:?}", channel_id);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to get channel info",
                ).into_response()
            })?;

        let role = get_user_role(&user_context, &info, &participants).await;
        Ok(UserContextWithRole {
            context: user_context,
            user_id: macro_user_id,
            role,
        })
    }
}

#[derive(Clone, Debug)]
pub struct ChannelMember(pub UserContextWithRole);

#[async_trait]
impl<S> FromRequestParts<S> for ChannelMember
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_context_with_role = UserContextWithRole::from_request_parts(parts, state).await?;

        match user_context_with_role.role {
            Some(_) => Ok(ChannelMember(user_context_with_role)),
            _ => Err(unauthorized("user is not authorized to view this channel")),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChannelOwner(pub UserContextWithRole);

#[async_trait]
impl<S> FromRequestParts<S> for ChannelOwner
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_context_with_role = UserContextWithRole::from_request_parts(parts, state).await?;

        match user_context_with_role.role {
            Some(models_comms::channel::ParticipantRole::Owner) => {
                Ok(ChannelOwner(user_context_with_role))
            }
            _ => Err(unauthorized("user is not authorized to view this channel")),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChannelAdmin(pub UserContextWithRole);

#[async_trait]
impl<S> FromRequestParts<S> for ChannelAdmin
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_context_with_role = UserContextWithRole::from_request_parts(parts, state).await?;

        match user_context_with_role.role {
            Some(
                models_comms::channel::ParticipantRole::Owner
                | models_comms::channel::ParticipantRole::Admin,
            ) => Ok(ChannelAdmin(user_context_with_role)),
            _ => Err(unauthorized("user is not authorized to view this channel")),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MessageId(pub Uuid);

#[async_trait]
impl<S> FromRequestParts<S> for MessageId
where
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        const MESSAGE_ID: &str = "message_id";
        let id = extract_path_uuid_by_name(parts, MESSAGE_ID).await?;
        Ok(MessageId(id))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MessageSender(pub UserContext);

#[async_trait]
impl<S> FromRequestParts<S> for MessageSender
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_context_with_role = extract_cached::<UserContextWithRole, _>(parts, state).await?;
        let MessageId(message_id) = extract_cached::<MessageId, _>(parts, state).await?;

        let message_owner = get_message_owner(&PgPool::from_ref(state), &message_id)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "unable to get message owner");
                (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
            })?;

        match user_context_with_role.role {
            Some(_) if message_owner == user_context_with_role.context.user_id => {
                Ok(MessageSender(user_context_with_role.context.clone()))
            }
            _ => Err(unauthorized("user is not authorized to view this channel")),
        }
    }
}

#[derive(Clone, Debug)]
#[expect(dead_code)]
pub enum MessageSenderOrAdmin {
    MessageSender(MessageSender),
    ChannelAdmin(ChannelAdmin),
}

#[async_trait]
impl<S> FromRequestParts<S> for MessageSenderOrAdmin
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if let Ok(sender) = extract_cached::<MessageSender, _>(parts, state).await {
            return Ok(Self::MessageSender(sender));
        }

        extract_cached::<ChannelAdmin, _>(parts, state)
            .await
            .map(Self::ChannelAdmin)
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for ParticipantAccess
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_context_with_role = extract_cached::<UserContextWithRole, _>(parts, state).await?;

        match user_context_with_role.role {
            Some(role) => Ok(ParticipantAccess::Access {
                role: ParticipantRole::mirror(role),
            }),
            _ => Ok(ParticipantAccess::NoAccess),
        }
    }
}
