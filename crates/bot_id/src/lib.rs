#![deny(missing_docs)]

//! Bot identity primitives.

use cowlike::{ArcCowStr, CowLike};
use nom::{
    Finish, IResult, Parser,
    bytes::complete::tag,
    character::complete::char,
    combinator::{eof, map_res, recognize},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use cowlike;

#[cfg(test)]
mod test;

const BOT_STORAGE_PREFIX: &str = "bot";
const UUID_HYPHENATED_LEN: usize = 36;

fn uuid_literal(input: &str) -> IResult<&str, BotId> {
    map_res(
        recognize(nom::bytes::complete::take_while_m_n(
            UUID_HYPHENATED_LEN,
            UUID_HYPHENATED_LEN,
            |c: char| c.is_ascii_hexdigit() || c == '-',
        )),
        |value| Uuid::parse_str(value).map(BotId),
    )
    .parse(input)
}

fn bot_id_str(input: &str) -> IResult<&str, BotIdStorage<ArcCowStr<'_>>> {
    let (rest, (((prefix, pipe), bot_id), _eof)) = tag(BOT_STORAGE_PREFIX)
        .and(char('|'))
        .and(uuid_literal)
        .and(eof)
        .parse(input)?;

    let bot_id_part_offset = prefix.len() + pipe.len_utf8();
    Ok((
        rest,
        BotIdStorage {
            bot_id,
            bot_id_part_offset,
            storage_id: ArcCowStr::Borrowed(input),
        },
    ))
}

/// Stable [`BotId`] for the first-party "Macro AI" system bot.
///
/// Mentioning it opens an agent session served by the in-process (in-memory)
/// agent harness, which answers with the Macro product toolset.
pub const MACRO_AI_BOT_ID: BotId =
    BotId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_a1a1));

/// Stable handle for the "Macro AI" system bot (used for `@` mentions).
pub const MACRO_AI_HANDLE: &str = "macro";

/// Display name for the "Macro" system bot.
pub const MACRO_AI_NAME: &str = "Macro";

/// Stable [`BotId`] for autonomous Macro platform operations.
pub const MACRO_SYSTEM_BOT_ID: BotId =
    BotId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_5759));

/// Display name for the autonomous Macro platform principal.
pub const MACRO_SYSTEM_NAME: &str = "Macro System";

/// Stable [`BotId`] for the "Macro Coder" system bot, our coding-agent harness.
///
/// Distinct from [`MACRO_AI_BOT_ID`] on purpose: the Macro bot's sessions run
/// in-process on the in-memory harness, while this one's run in a provisioned
/// sandbox, and one id cannot mean both.
pub const MACRO_CODER_BOT_ID: BotId =
    BotId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_a9e7));

/// Stable handle for the "Macro Coder" system bot (used for `@` mentions).
pub const MACRO_CODER_HANDLE: &str = "coder";

/// Display name for the "Macro Coder" system bot.
pub const MACRO_CODER_NAME: &str = "Macro Coder";

/// Stable [`BotId`] for the "Cursor" system bot.
///
/// Mentioning it opens an agent session like [`MACRO_CODER_BOT_ID`] does, but
/// the session is served by a Cursor cloud agent rather than a Macro-managed
/// sandbox.
pub const CURSOR_BOT_ID: BotId =
    BotId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_c5c5));

/// Stable handle for the "Cursor" system bot (used for `@` mentions).
pub const CURSOR_HANDLE: &str = "cursor";

/// Display name for the "Cursor" system bot.
pub const CURSOR_NAME: &str = "Cursor";

/// Stable handle for the autonomous Macro platform principal.
pub const MACRO_SYSTEM_HANDLE: &str = "macro-system";

/// A first-party bot.
///
/// System bots live here rather than in the `bots` table. Their ids are
/// compile-time constants, so a row would only be a second copy of this one
/// that an environment could be missing - which is exactly how a deployment
/// ends up serving a bot it cannot look up. Only user- and team-owned bots
/// are rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemBot {
    /// Stable id.
    pub id: BotId,
    /// Display name.
    pub name: &'static str,
    /// Handle used for `@` mentions.
    pub handle: &'static str,
    /// Whether mentioning this bot opens an agent session.
    pub has_agent: bool,
}

/// Every first-party bot.
pub const SYSTEM_BOTS: &[SystemBot] = &[
    SystemBot {
        id: MACRO_AI_BOT_ID,
        name: MACRO_AI_NAME,
        handle: MACRO_AI_HANDLE,
        has_agent: true,
    },
    SystemBot {
        id: MACRO_CODER_BOT_ID,
        name: MACRO_CODER_NAME,
        handle: MACRO_CODER_HANDLE,
        has_agent: true,
    },
    SystemBot {
        id: CURSOR_BOT_ID,
        name: CURSOR_NAME,
        handle: CURSOR_HANDLE,
        has_agent: true,
    },
    // Posts as itself for autonomous platform operations, but nothing mentions
    // it and it opens no sessions.
    SystemBot {
        id: MACRO_SYSTEM_BOT_ID,
        name: MACRO_SYSTEM_NAME,
        handle: MACRO_SYSTEM_HANDLE,
        has_agent: false,
    },
];

/// The first-party bot with this id, when it is one.
#[must_use]
pub fn system_bot(id: BotId) -> Option<&'static SystemBot> {
    SYSTEM_BOTS.iter().find(|bot| bot.id == id)
}

/// The first-party bot with this handle, when it is one.
#[must_use]
pub fn system_bot_by_handle(handle: &str) -> Option<&'static SystemBot> {
    SYSTEM_BOTS.iter().find(|bot| bot.handle == handle)
}

/// Whether `id` is a first-party bot, and so has no `bots` row.
#[must_use]
pub fn is_system_bot(id: BotId) -> bool {
    system_bot(id).is_some()
}

/// A bot id UUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BotId(Uuid);

impl BotId {
    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_A: Self = Self(Uuid::from_u128(0xB07A));

    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_B: Self = Self(Uuid::from_u128(0xB07B));

    /// Build a bot id from its UUID.
    pub const fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// Return the underlying UUID.
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }

    /// Parse a bot id from its UUID string representation.
    pub fn parse_uuid_str(value: &str) -> Result<Self, BotIdParseError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| BotIdParseError::invalid(value))
    }

    /// Canonical storage representation as a parsed [`BotIdStr`].
    pub fn into_storage_id(self) -> BotIdStr<'static> {
        let storage_id = format!("{BOT_STORAGE_PREFIX}|{}", self.0);
        BotIdStr(BotIdStorage {
            bot_id: self,
            bot_id_part_offset: BOT_STORAGE_PREFIX.len() + 1,
            storage_id: ArcCowStr::Owned(storage_id.into()),
        })
    }
}

impl std::fmt::Display for BotId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for BotId {
    type Err = BotIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_uuid_str(value)
    }
}

/// A parsed bot storage principal, `bot|<uuid>`.
#[derive(Clone, Copy)]
pub struct BotIdStorage<T> {
    bot_id: BotId,
    bot_id_part_offset: usize,
    storage_id: T,
}

impl<T> std::fmt::Debug for BotIdStorage<T>
where
    T: AsRef<str>,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.storage_id.as_ref())
    }
}

impl<T> PartialEq for BotIdStorage<T>
where
    T: PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        self.bot_id == other.bot_id
    }
}

impl<T> Eq for BotIdStorage<T> where T: Eq {}

impl<T> std::hash::Hash for BotIdStorage<T>
where
    T: std::hash::Hash,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.bot_id.hash(state);
    }
}

impl<T> BotIdStorage<T> {
    fn map<F, U>(self, f: F) -> BotIdStorage<U>
    where
        F: FnOnce(T) -> U,
    {
        BotIdStorage {
            bot_id: self.bot_id,
            bot_id_part_offset: self.bot_id_part_offset,
            storage_id: f(self.storage_id),
        }
    }
}

impl<T> AsRef<str> for BotIdStorage<T>
where
    T: AsRef<str>,
{
    fn as_ref(&self) -> &str {
        self.storage_id.as_ref()
    }
}

impl<T> BotIdStorage<T>
where
    T: AsRef<str>,
{
    /// Return the parsed bot UUID newtype.
    pub const fn bot_id(&self) -> BotId {
        self.bot_id
    }

    /// Return the UUID portion as a string slice.
    pub fn uuid_str(&self) -> &str {
        let storage_id = self.storage_id.as_ref();
        &storage_id[self.bot_id_part_offset..]
    }
}

impl<'a, T> CowLike<'a> for BotIdStorage<T>
where
    T: CowLike<'a>,
{
    type Owned<'b> = BotIdStorage<T::Owned<'b>>;

    fn into_owned(self) -> BotIdStorage<T::Owned<'static>> {
        self.map(CowLike::into_owned)
    }

    fn copied(&'a self) -> Self {
        BotIdStorage {
            bot_id: self.bot_id,
            bot_id_part_offset: self.bot_id_part_offset,
            storage_id: self.storage_id.copied(),
        }
    }
}

impl<'a> BotIdStorage<ArcCowStr<'a>> {
    /// Attempt to create a borrowed parsed bot storage principal from an input string.
    pub fn parse_from_str(input: &'a str) -> Result<Self, BotIdParseError> {
        let (_, out) = bot_id_str(input)
            .finish()
            .map_err(|_| BotIdParseError::invalid(input))?;
        Ok(out)
    }
}

/// The standard string newtype for a parsed bot storage principal, `bot|<uuid>`.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct BotIdStr<'a>(pub BotIdStorage<ArcCowStr<'a>>);

impl<'a> std::fmt::Debug for BotIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

impl<'a> std::fmt::Display for BotIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

impl<'a> AsRef<str> for BotIdStr<'a> {
    fn as_ref(&self) -> &str {
        self.0.as_ref()
    }
}

impl<'a> BotIdStr<'a> {
    /// Parse the inner value from the input string.
    pub fn parse_from_str(s: &'a str) -> Result<Self, BotIdParseError> {
        BotIdStorage::parse_from_str(s).map(BotIdStr)
    }

    /// Return the parsed bot UUID newtype.
    pub const fn bot_id(&self) -> BotId {
        self.0.bot_id
    }

    /// Return the parsed UUID.
    pub const fn as_uuid(&self) -> Uuid {
        self.0.bot_id.as_uuid()
    }
}

impl From<BotId> for BotIdStr<'static> {
    fn from(value: BotId) -> Self {
        BotId::into_storage_id(value)
    }
}

impl TryFrom<String> for BotIdStr<'static> {
    type Error = BotIdParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let s = value.as_str();
        BotIdStr::try_from(s).map(|x| x.into_owned())
    }
}

impl<'a> TryFrom<&'a str> for BotIdStr<'a> {
    type Error = BotIdParseError;

    fn try_from(value: &'a str) -> Result<Self, Self::Error> {
        Self::parse_from_str(value)
    }
}

impl From<BotIdStr<'_>> for String {
    fn from(value: BotIdStr<'_>) -> Self {
        value.0.as_ref().to_string()
    }
}

impl<'a> CowLike<'a> for BotIdStr<'a> {
    type Owned<'b> = BotIdStr<'b>;

    fn into_owned(self) -> Self::Owned<'static> {
        BotIdStr(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        BotIdStr(self.0.copied())
    }
}

/// Error returned when a bot id cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid bot id: {value}")]
pub struct BotIdParseError {
    value: String,
}

impl BotIdParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

#[cfg(feature = "schema")]
impl utoipa::ToSchema for BotId {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("BotId")
    }
}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for BotId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for BotId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::Type<sqlx::Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <Uuid as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for BotId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for BotId {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <Uuid as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.0, buf)
    }

    fn size_hint(&self) -> usize {
        <Uuid as sqlx::Encode<sqlx::Postgres>>::size_hint(&self.0)
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for BotId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <Uuid as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self(value))
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for BotIdStr<'static> {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        BotIdStr::try_from(value).map_err(Into::into)
    }
}
