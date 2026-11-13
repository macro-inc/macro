//! 1Password `.1pux`: a zip whose `export.data` is JSON, accounts → vaults →
//! items. Items have `uuid`, `categoryUuid` (3-digit codes), `state`
//! (`active`/`archived`), `trashed`, `favIndex`, `overview.{title, url,
//! urls[].url, tags}` and `details.{loginFields[] (designation username or
//! password), notesPlain, password, sections[].fields[] {title, id, value:
//! {<type>: v}}, passwordHistory, passkey, documentAttributes}`. Other `files/`
//! entries are never read.
use std::fmt;
use std::marker::PhantomData;

use serde::Deserialize;
use serde::de::{Deserializer, IgnoredAny, MapAccess, Visitor};
use serde_json::value::RawValue;

use crate::bounded::{Bounded, Count, Counted, null_as_empty};
use crate::draft::{self, Draft, Parts};
use crate::error::ImportError;
use crate::model::{
    DroppedPart, FolderPath, ItemKind, Limits, Secret, SkipReason, SourceFolder, SourceKey,
};
use crate::zip_archive;

/// The export's accounts, vaults and items, counted before anything is kept.
#[derive(Deserialize)]
struct Shape {
    accounts: Option<Count<AccountShape>>,
}

#[derive(Deserialize)]
struct AccountShape {
    #[serde(default)]
    vaults: Count<VaultShape>,
}

impl Counted for AccountShape {
    fn nested(&self) -> usize {
        self.vaults.total
    }
}

#[derive(Deserialize)]
struct VaultShape {
    #[serde(default)]
    items: Count<IgnoredAny>,
}

impl Counted for VaultShape {
    fn nested(&self) -> usize {
        self.items.total
    }
}

#[derive(Deserialize)]
struct Export<'a> {
    #[serde(borrow)]
    accounts: Option<Vec<Account<'a>>>,
}

#[derive(Deserialize)]
struct Account<'a> {
    attrs: Option<AccountAttributes>,
    #[serde(borrow, default, deserialize_with = "null_as_empty")]
    vaults: Vec<Vault<'a>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountAttributes {
    uuid: Option<String>,
    account_name: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Vault<'a> {
    attrs: Option<VaultAttributes>,
    #[serde(borrow, default, deserialize_with = "null_as_empty")]
    items: Vec<&'a RawValue>,
}

#[derive(Deserialize)]
struct VaultAttributes {
    uuid: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Item<'a> {
    uuid: Option<String>,
    #[serde(rename = "favIndex")]
    favorite_index: Option<i64>,
    state: Option<ItemState>,
    trashed: Option<bool>,
    #[serde(rename = "categoryUuid")]
    category: Option<Category>,
    #[serde(borrow)]
    details: Option<Details<'a>>,
    overview: Option<Overview>,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ItemState {
    Active,
    Archived,
    Trashed,
    Deleted,
    #[serde(other)]
    Unknown,
}

/// What a `categoryUuid` becomes in the vault.
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
enum Category {
    /// Login, Password, Database, Wireless Router, Server, Email Account.
    #[serde(
        rename = "001",
        alias = "005",
        alias = "102",
        alias = "109",
        alias = "110",
        alias = "111"
    )]
    Login,
    #[serde(rename = "002")]
    Card,
    /// Secure Note; Software License, Bank Account, Reward Program and Crypto
    /// Wallet are notes with fields.
    #[serde(
        rename = "003",
        alias = "100",
        alias = "101",
        alias = "107",
        alias = "115"
    )]
    Note,
    /// Identity, Driver License, Outdoor License, Membership, Passport, Social
    /// Security Number, Medical Record.
    #[serde(
        rename = "004",
        alias = "103",
        alias = "104",
        alias = "105",
        alias = "106",
        alias = "108",
        alias = "113"
    )]
    Identity,
    /// API Credential.
    #[serde(rename = "112")]
    Api,
    /// SSH Key: an `Api` item, but its own `username`/`hostname` ids aren't
    /// API credential fields.
    #[serde(rename = "114")]
    SshKey,
    /// Document: the file itself is the item.
    #[serde(rename = "006")]
    Document,
    #[serde(other)]
    Unsupported,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Details<'a> {
    #[serde(default)]
    login_fields: Bounded<LoginField>,
    #[serde(rename = "notesPlain")]
    notes: Option<Secret>,
    #[serde(borrow, default)]
    sections: Bounded<Section<'a>>,
    password_history: Option<Vec<IgnoredAny>>,
    document_attributes: Option<IgnoredAny>,
    password: Option<Secret>,
    passkey: Option<IgnoredAny>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginField {
    value: Option<Secret>,
    name: Option<String>,
    designation: Option<Designation>,
    field_type: Option<LoginFieldType>,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Designation {
    Username,
    Password,
    #[serde(other)]
    Other,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
enum LoginFieldType {
    #[serde(rename = "P")]
    Password,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct Section<'a> {
    title: Option<String>,
    #[serde(borrow, default)]
    fields: Bounded<SectionField<'a>>,
}

#[derive(Deserialize)]
struct SectionField<'a> {
    title: Option<String>,
    id: Option<String>,
    #[serde(borrow, default)]
    value: TypedValue<'a>,
}

/// A section value: `{<type>: v}`. One key; any others are ignored unread.
#[derive(Default)]
struct TypedValue<'a>(Option<(ValueType, &'a RawValue)>);

impl<'de: 'a, 'a> Deserialize<'de> for TypedValue<'a> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(TypedValueVisitor(PhantomData))
    }
}

struct TypedValueVisitor<'a>(PhantomData<&'a ()>);

impl<'de: 'a, 'a> Visitor<'de> for TypedValueVisitor<'a> {
    type Value = TypedValue<'a>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a typed value")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let first = map.next_entry::<ValueType, &'a RawValue>()?;
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(TypedValue(first))
    }
}

/// The value types a section field can hold.
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ValueType {
    String,
    Concealed,
    Phone,
    Menu,
    Gender,
    CreditCardNumber,
    CreditCardType,
    Url,
    Totp,
    Email,
    Date,
    MonthYear,
    Address,
    SshKey,
    File,
    /// A link to another item, meaningless outside 1Password.
    Reference,
    #[serde(other)]
    Unknown,
}

#[derive(Deserialize)]
struct Overview {
    title: Option<String>,
    url: Option<String>,
    #[serde(default)]
    urls: Bounded<OverviewUrl>,
    #[serde(default)]
    tags: Bounded<String>,
}

#[derive(Deserialize)]
struct OverviewUrl {
    label: Option<String>,
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum EmailValue {
    Plain(Secret),
    Structured { email_address: Option<Secret> },
}

#[derive(Deserialize)]
struct AddressValue {
    street: Option<Secret>,
    city: Option<Secret>,
    state: Option<Secret>,
    zip: Option<Secret>,
    country: Option<Secret>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshKeyValue {
    private_key: Option<Secret>,
    metadata: Option<SshKeyMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshKeyMetadata {
    public_key: Option<Secret>,
    fingerprint: Option<Secret>,
    key_type: Option<Secret>,
}

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let data = zip_archive::read_export_data(bytes, limits)?;
    let data = crate::strip_byte_order_mark(&data);

    // Count first: an empty vault or a `0` item costs two bytes of input but
    // a kept entry each, before any limit applied.
    let shape: Shape = serde_json::from_slice(data).map_err(|error| ImportError::json(&error))?;
    let entries = shape.accounts.ok_or(ImportError::UnsupportedVersion)?.total;
    if entries > limits.max_items {
        return Err(ImportError::TooManyItems);
    }

    let export: Export<'_> =
        serde_json::from_slice(data).map_err(|error| ImportError::json(&error))?;
    let accounts = export.accounts.ok_or(ImportError::UnsupportedVersion)?;

    let several_accounts = accounts.len() > 1;
    let mut parts = Parts::default();
    let mut index = 0;

    for account in &accounts {
        let account_attrs = account.attrs.as_ref();
        let account_uuid = account_attrs.and_then(|attrs| attrs.uuid.as_deref());
        let account_name = account_attrs
            .and_then(|attrs| attrs.account_name.as_deref().or(attrs.name.as_deref()))
            .unwrap_or_default();

        for vault in &account.vaults {
            let vault_attrs = vault.attrs.as_ref();
            let vault_name = vault_attrs
                .and_then(|attrs| attrs.name.as_deref())
                .unwrap_or_default();
            // Item uuids are unique within a vault, vault uuids within an account.
            let scope = [
                account_uuid,
                vault_attrs.and_then(|attrs| attrs.uuid.as_deref()),
            ];

            // With several accounts, `Account / Vault` keeps same-named vaults apart.
            let folder = if several_accounts {
                FolderPath::parse([account_name, vault_name])
            } else {
                FolderPath::parse([vault_name])
            };

            for raw in &vault.items {
                match serde_json::from_str::<Item<'_>>(raw.get()) {
                    Ok(item) => add_item(&mut parts, item, &scope, index, &folder),
                    Err(_) => parts.skip(
                        Some(SourceKey::of_malformed(raw, &scope, index)),
                        None,
                        SkipReason::Malformed,
                    ),
                }
                index += 1;
            }
        }
    }

    Ok(parts)
}

fn add_item(
    parts: &mut Parts,
    item: Item<'_>,
    scope: &[Option<&str>],
    index: usize,
    folder: &SourceFolder,
) {
    let key = SourceKey::from_scoped_id_or_index(scope, item.uuid.as_deref(), index);
    let name = item
        .overview
        .as_ref()
        .and_then(|overview| overview.title.as_deref());

    let state = item.state.unwrap_or(ItemState::Active);
    if item.trashed == Some(true) || matches!(state, ItemState::Trashed | ItemState::Deleted) {
        return parts.skip(Some(key), name, SkipReason::Trashed);
    }
    if state == ItemState::Archived {
        return parts.skip(Some(key), name, SkipReason::Archived);
    }

    let category = item.category.unwrap_or(Category::Unsupported);
    let kind = match category {
        Category::Login => ItemKind::Login,
        Category::Card => ItemKind::Card,
        Category::Note => ItemKind::Note,
        Category::Identity => ItemKind::Identity,
        Category::Api | Category::SshKey => ItemKind::Api,
        Category::Document => return parts.skip(Some(key), name, SkipReason::Attachment),
        Category::Unsupported => {
            return parts.skip(Some(key), name, SkipReason::UnsupportedCategory);
        }
    };

    let mut draft = Draft::new(key, kind);
    draft.set_name(name.map(str::to_owned));
    draft.set_favorite(item.favorite_index.is_some_and(|index| index > 0));
    draft.set_folder(folder.clone());

    if let Some(overview) = item.overview {
        if overview.urls.overflowed || overview.tags.overflowed {
            draft.mark_too_large();
        }
        // `url` is the primary URL; `urls` repeats it among labeled others.
        if let Some(url) = overview.url {
            draft.add_url(&url);
        }
        for url in overview.urls.entries {
            let label = url.label.filter(|label| !label.trim().is_empty());
            if let Some(value) = url.url {
                draft.add_labeled_url(label, &value, false);
            }
        }
        for tag in overview.tags.entries {
            draft.add_tag(&tag);
        }
    }

    if let Some(details) = item.details {
        add_details(&mut draft, details, category);
    }

    parts.add(draft);
}

fn add_details(draft: &mut Draft, details: Details<'_>, category: Category) {
    if details.login_fields.overflowed || details.sections.overflowed {
        draft.mark_too_large();
    }

    for field in details.login_fields.entries {
        let Some(value) = field.value else {
            continue;
        };
        let label = field.name.as_deref().unwrap_or_default();

        match field.designation {
            Some(Designation::Username) => draft.add_username_labeled(value, label),
            Some(Designation::Password) => draft.add_password_labeled(value, label),
            Some(Designation::Other) | None => {
                let concealed = field.field_type == Some(LoginFieldType::Password);
                draft.add_field(label, value, concealed);
            }
        }
    }

    if let Some(password) = details.password {
        draft.add_password(password);
    }
    if let Some(notes) = details.notes {
        draft.set_notes(notes);
    }

    let history = details.password_history.map_or(0, |history| history.len());
    draft.drop_part(DroppedPart::PasswordHistory, history);
    if details.passkey.is_some() {
        draft.drop_part(DroppedPart::Passkey, 1);
    }
    if details.document_attributes.is_some() {
        draft.drop_part(DroppedPart::Attachment, 1);
    }

    let mut name_parts = NameParts::default();
    for section in details.sections.entries {
        if section.fields.overflowed {
            draft.mark_too_large();
        }
        let section_title = section.title.as_deref().unwrap_or_default().trim();

        for field in section.fields.entries {
            let field_title = field
                .title
                .as_deref()
                .filter(|title| !title.trim().is_empty())
                .or(field.id.as_deref())
                .unwrap_or_default()
                .trim();
            let label = if section_title.is_empty() {
                field_title.to_owned()
            } else {
                format!("{section_title} · {field_title}")
            };

            let TypedValue(Some((value_type, raw))) = field.value else {
                continue;
            };
            let id = field.id.as_deref().unwrap_or_default();

            add_section_field(
                draft,
                category,
                id,
                &label,
                value_type,
                raw,
                &mut name_parts,
            );
        }
    }

    if draft.kind() == ItemKind::Identity {
        draft.add_full_name(
            [&name_parts.first, &name_parts.initial, &name_parts.last].map(Secret::expose_secret),
        );
    }
}

/// An Identity's name, assembled from its separate fields.
#[derive(Default)]
struct NameParts {
    first: Secret,
    initial: Secret,
    last: Secret,
}

/// A decoded section value, or what to do instead.
enum SectionValue {
    Text { value: Secret, concealed: bool },
    OneTimePassword(Secret),
    Url(Secret),
    SshKey(SshKeyValue),
    Attachment,
    Unsupported,
}

fn decode(value_type: ValueType, raw: &RawValue) -> SectionValue {
    let secret = || serde_json::from_str::<Secret>(raw.get()).ok();
    let text = |concealed| {
        secret().map_or(SectionValue::Unsupported, |value| SectionValue::Text {
            value,
            concealed,
        })
    };

    match value_type {
        ValueType::Concealed | ValueType::CreditCardNumber => text(true),
        ValueType::String
        | ValueType::Phone
        | ValueType::Menu
        | ValueType::Gender
        | ValueType::CreditCardType => text(false),
        ValueType::Url => secret().map_or(SectionValue::Unsupported, SectionValue::Url),
        ValueType::Totp => {
            secret().map_or(SectionValue::Unsupported, SectionValue::OneTimePassword)
        }
        ValueType::Email => match serde_json::from_str::<EmailValue>(raw.get()) {
            Ok(EmailValue::Plain(value)) => SectionValue::Text {
                value,
                concealed: false,
            },
            Ok(EmailValue::Structured { email_address }) => SectionValue::Text {
                value: email_address.unwrap_or_default(),
                concealed: false,
            },
            Err(_) => SectionValue::Unsupported,
        },
        // An empty field: nothing to carry over, and nothing dropped.
        ValueType::Date | ValueType::MonthYear if raw.get() == "null" => SectionValue::Text {
            value: Secret::new(String::new()),
            concealed: false,
        },
        // Unix seconds, shown as a calendar date.
        ValueType::Date => match serde_json::from_str::<i64>(raw.get())
            .ok()
            .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        {
            Some(date) => SectionValue::Text {
                value: Secret::new(date.format("%Y-%m-%d").to_string()),
                concealed: false,
            },
            None => SectionValue::Unsupported,
        },
        ValueType::MonthYear => match serde_json::from_str::<u32>(raw.get()) {
            // `YYYYMM`, shown the way cards print it.
            Ok(month_year) => SectionValue::Text {
                value: Secret::new(format!("{:02}/{}", month_year % 100, month_year / 100)),
                concealed: false,
            },
            Err(_) => SectionValue::Unsupported,
        },
        ValueType::Address => match serde_json::from_str::<AddressValue>(raw.get()) {
            Ok(address) => {
                let parts = [
                    &address.street,
                    &address.city,
                    &address.state,
                    &address.zip,
                    &address.country,
                ];
                SectionValue::Text {
                    value: draft::address_text(
                        parts.into_iter().flatten().map(Secret::expose_secret),
                    ),
                    concealed: false,
                }
            }
            Err(_) => SectionValue::Unsupported,
        },
        ValueType::SshKey => match serde_json::from_str::<SshKeyValue>(raw.get()) {
            Ok(key) => SectionValue::SshKey(key),
            Err(_) => SectionValue::Unsupported,
        },
        ValueType::File => SectionValue::Attachment,
        ValueType::Reference => SectionValue::Unsupported,
        // Unknown value types are kept when they are plain text.
        ValueType::Unknown => text(false),
    }
}

fn add_section_field(
    draft: &mut Draft,
    category: Category,
    id: &str,
    label: &str,
    value_type: ValueType,
    raw: &RawValue,
    name_parts: &mut NameParts,
) {
    let (value, concealed) = match decode(value_type, raw) {
        SectionValue::Text { value, concealed } => (value, concealed),
        SectionValue::OneTimePassword(value) => return draft.add_one_time_password(value),
        SectionValue::Url(value) => {
            return draft.add_labeled_url(Some(label.to_owned()), value.expose_secret(), false);
        }
        SectionValue::SshKey(key) => return add_ssh_key(draft, key, label),
        SectionValue::Attachment => return draft.drop_part(DroppedPart::Attachment, 1),
        SectionValue::Unsupported => return draft.drop_part(DroppedPart::ExtraField, 1),
    };

    match (category, id) {
        (Category::Login, "username" | "pop_username") => draft.add_username_labeled(value, label),
        (Category::Login, "password" | "pop_password") => draft.add_password_labeled(value, label),
        // A hidden value stays hidden wherever it lands.
        (Category::Login, "url" | "hostname" | "server") | (Category::Api, "hostname") => {
            draft.add_labeled_url(Some(label.to_owned()), value.expose_secret(), concealed);
        }
        (Category::Card, "cardholder") => draft.add_username_labeled(value, label),
        (Category::Card, "ccnum") => draft.add_password_labeled(value, label),
        (Category::Card, "expiry") => draft.add_field(draft::EXPIRES, value, false),
        (Category::Card, "cvv") => draft.add_field(draft::SECURITY_CODE, value, true),
        (Category::Identity, "firstname") => name_parts.first = value,
        (Category::Identity, "initial") => name_parts.initial = value,
        (Category::Identity, "lastname") => name_parts.last = value,
        (Category::Identity, "fullname" | "name" | "member_name") => {
            draft.add_username_labeled(value, label);
        }
        (Category::Identity, "email") => draft.add_field(draft::EMAIL, value, false),
        (Category::Identity, "defphone" | "cellphone" | "homephone" | "busphone") => {
            draft.add_field(draft::PHONE, value, false);
        }
        (Category::Identity, "address") => draft.add_field(draft::ADDRESS, value, false),
        (Category::Api, "credential") => draft.add_password_labeled(value, label),
        (Category::Api, "username") => draft.add_username_labeled(value, label),
        _ => draft.add_field(label, value, concealed),
    }
}

fn add_ssh_key(draft: &mut Draft, key: SshKeyValue, label: &str) {
    let (public_key, fingerprint, key_type) = match key.metadata {
        Some(metadata) => (metadata.public_key, metadata.fingerprint, metadata.key_type),
        None => (None, None, None),
    };
    draft.add_ssh_key(key.private_key, label, public_key, fingerprint);
    if let Some(key_type) = key_type {
        draft.add_field("Key type", key_type, false);
    }
}
