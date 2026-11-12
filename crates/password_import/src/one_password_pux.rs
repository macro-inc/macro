//! 1Password `.1pux`: `export.data` is JSON, accounts → vaults → items.
use std::collections::BTreeMap;

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::value::RawValue;

use crate::draft::{self, Draft, Parts};
use crate::error::ImportError;
use crate::model::{
    DroppedPart, FolderPath, ItemKind, Limits, Secret, SegmentTooLong, SkipReason, SourceKey,
};
use crate::zip_archive;

#[derive(Deserialize)]
struct Export<'a> {
    #[serde(borrow)]
    accounts: Option<Vec<Account<'a>>>,
}

#[derive(Deserialize)]
struct Account<'a> {
    attrs: Option<AccountAttributes>,
    #[serde(borrow, default)]
    vaults: Vec<Vault<'a>>,
}

#[derive(Deserialize)]
struct AccountAttributes {
    #[serde(rename = "accountName")]
    account_name: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Vault<'a> {
    attrs: Option<VaultAttributes>,
    #[serde(borrow, default)]
    items: Vec<&'a RawValue>,
}

#[derive(Deserialize)]
struct VaultAttributes {
    name: Option<String>,
}

/// The uuid only, to name an item whose full shape didn't parse.
#[derive(Deserialize)]
struct ItemId {
    uuid: Option<String>,
}

#[derive(Deserialize)]
struct Item<'a> {
    uuid: Option<String>,
    #[serde(rename = "favIndex")]
    favorite_index: Option<i64>,
    state: Option<String>,
    trashed: Option<bool>,
    #[serde(rename = "categoryUuid")]
    category: Option<String>,
    #[serde(borrow)]
    details: Option<Details<'a>>,
    overview: Option<Overview>,
}

#[derive(Deserialize)]
struct Details<'a> {
    #[serde(rename = "loginFields")]
    login_fields: Option<Vec<LoginField>>,
    #[serde(rename = "notesPlain")]
    notes: Option<Secret>,
    #[serde(borrow)]
    sections: Option<Vec<Section<'a>>>,
    #[serde(rename = "passwordHistory")]
    password_history: Option<Vec<IgnoredAny>>,
    #[serde(rename = "documentAttributes")]
    document_attributes: Option<IgnoredAny>,
    password: Option<Secret>,
    passkey: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct LoginField {
    value: Option<Secret>,
    name: Option<String>,
    designation: Option<String>,
    #[serde(rename = "fieldType")]
    field_type: Option<String>,
}

#[derive(Deserialize)]
struct Section<'a> {
    title: Option<String>,
    #[serde(borrow)]
    fields: Option<Vec<SectionField<'a>>>,
}

#[derive(Deserialize)]
struct SectionField<'a> {
    title: Option<String>,
    id: Option<String>,
    /// One key naming the value type (`string`, `concealed`, `totp`, ...).
    #[serde(borrow)]
    value: Option<BTreeMap<String, &'a RawValue>>,
}

#[derive(Deserialize)]
struct Overview {
    title: Option<String>,
    url: Option<String>,
    urls: Option<Vec<OverviewUrl>>,
    tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OverviewUrl {
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
struct SshKeyValue {
    #[serde(rename = "privateKey")]
    private_key: Option<Secret>,
    metadata: Option<SshKeyMetadata>,
}

#[derive(Deserialize)]
struct SshKeyMetadata {
    #[serde(rename = "publicKey")]
    public_key: Option<Secret>,
    fingerprint: Option<Secret>,
    #[serde(rename = "keyType")]
    key_type: Option<Secret>,
}

/// What a category becomes in the vault.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Category {
    Login,
    Card,
    Note,
    Identity,
    Api,
    SshKey,
    Document,
    Unsupported,
}

fn category(uuid: Option<&str>) -> Category {
    match uuid {
        // Login, Password, Database, Wireless Router, Server, Email Account.
        Some("001" | "005" | "102" | "109" | "110" | "111") => Category::Login,
        Some("002") => Category::Card,
        // Secure Note; Software License, Bank Account, Reward Program and
        // Crypto Wallet are notes with fields.
        Some("003" | "100" | "101" | "107" | "115") => Category::Note,
        // Identity, Driver License, Outdoor License, Membership, Passport,
        // Social Security Number, Medical Record.
        Some("004" | "103" | "104" | "105" | "106" | "108" | "113") => Category::Identity,
        Some("112") => Category::Api,
        Some("114") => Category::SshKey,
        Some("006") => Category::Document,
        _ => Category::Unsupported,
    }
}

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let data = zip_archive::read_export_data(bytes, limits)?;
    let export: Export<'_> = serde_json::from_slice(&data).map_err(|error| ImportError::json(&error))?;
    let accounts = export.accounts.ok_or(ImportError::UnsupportedVersion)?;

    let item_count: usize = accounts
        .iter()
        .flat_map(|account| &account.vaults)
        .map(|vault| vault.items.len())
        .sum();
    if item_count > limits.max_items {
        return Err(ImportError::TooManyItems);
    }

    let several_accounts = accounts.len() > 1;
    let mut parts = Parts::default();
    let mut index = 0;

    for account in &accounts {
        let account_name = account
            .attrs
            .as_ref()
            .and_then(|attrs| attrs.account_name.as_deref().or(attrs.name.as_deref()))
            .unwrap_or_default();

        for vault in &account.vaults {
            let vault_name = vault
                .attrs
                .as_ref()
                .and_then(|attrs| attrs.name.as_deref())
                .unwrap_or_default();

            // With several accounts, `Account / Vault` keeps same-named vaults apart.
            let folder = if several_accounts {
                FolderPath::new([account_name, vault_name])
            } else {
                FolderPath::new([vault_name])
            };

            for raw in &vault.items {
                let key = SourceKey::from_item_index(index);
                index += 1;

                match serde_json::from_str::<Item<'_>>(raw.get()) {
                    Ok(item) => add_item(&mut parts, item, key, &folder),
                    Err(_) => {
                        let key = serde_json::from_str::<ItemId>(raw.get())
                            .ok()
                            .and_then(|item| item.uuid)
                            .and_then(|uuid| SourceKey::from_source_id(&uuid))
                            .unwrap_or(key);
                        parts.skip(Some(key), None, SkipReason::Malformed);
                    }
                }
            }
        }
    }

    Ok(parts)
}

fn add_item(
    parts: &mut Parts,
    item: Item<'_>,
    index_key: SourceKey,
    folder: &Result<Option<FolderPath>, SegmentTooLong>,
) {
    let key = item
        .uuid
        .as_deref()
        .and_then(SourceKey::from_source_id)
        .unwrap_or(index_key);
    let name = item.overview.as_ref().and_then(|overview| overview.title.as_deref());

    let state = item.state.as_deref();
    if item.trashed == Some(true) || matches!(state, Some("trashed" | "deleted")) {
        return parts.skip(Some(key), name, SkipReason::Trashed);
    }
    if state == Some("archived") {
        return parts.skip(Some(key), name, SkipReason::Archived);
    }

    let category = category(item.category.as_deref());
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
        for url in overview.urls.unwrap_or_default() {
            if let Some(url) = url.url {
                draft.add_url(&url);
            }
        }
        if let Some(url) = overview.url {
            draft.add_url(&url);
        }
        for tag in overview.tags.unwrap_or_default() {
            draft.add_tag(&tag);
        }
    }

    if let Some(details) = item.details {
        add_details(&mut draft, details, category);
    }

    parts.add(draft);
}

fn add_details(draft: &mut Draft, details: Details<'_>, category: Category) {
    for field in details.login_fields.unwrap_or_default() {
        let Some(value) = field.value else {
            continue;
        };
        let label = field.name.as_deref().unwrap_or_default();

        match field.designation.as_deref() {
            Some("username") => draft.username(value, label),
            Some("password") => draft.password(value, label),
            _ => {
                let concealed = field.field_type.as_deref() == Some("P");
                draft.field(label, value, concealed);
            }
        }
    }

    if let Some(password) = details.password {
        draft.password(password, "Password");
    }
    if let Some(notes) = details.notes {
        draft.notes(notes);
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
    for section in details.sections.unwrap_or_default() {
        let section_title = section.title.as_deref().unwrap_or_default().trim();

        for field in section.fields.unwrap_or_default() {
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

            let Some((value_type, raw)) = field.value.as_ref().and_then(|value| value.iter().next())
            else {
                continue;
            };
            let id = field.id.as_deref().unwrap_or_default();

            add_section_field(draft, category, id, &label, value_type, raw, &mut name_parts);
        }
    }

    if draft.kind() == ItemKind::Identity {
        let full_name = Secret::join(
            [&name_parts.first, &name_parts.initial, &name_parts.last].map(Secret::expose_secret),
            " ",
        );
        draft.username(full_name, "Name");
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

fn decode(value_type: &str, raw: &RawValue) -> SectionValue {
    let text = |concealed| match serde_json::from_str::<Secret>(raw.get()) {
        Ok(value) => SectionValue::Text { value, concealed },
        Err(_) => SectionValue::Unsupported,
    };

    match value_type {
        "concealed" | "creditCardNumber" => text(true),
        "string" | "phone" | "menu" | "gender" | "creditCardType" => text(false),
        "url" => match serde_json::from_str::<Secret>(raw.get()) {
            Ok(value) => SectionValue::Url(value),
            Err(_) => SectionValue::Unsupported,
        },
        "totp" => match serde_json::from_str::<Secret>(raw.get()) {
            Ok(value) => SectionValue::OneTimePassword(value),
            Err(_) => SectionValue::Unsupported,
        },
        "email" => match serde_json::from_str::<EmailValue>(raw.get()) {
            Ok(EmailValue::Plain(value)) => SectionValue::Text { value, concealed: false },
            Ok(EmailValue::Structured { email_address }) => SectionValue::Text {
                value: email_address.unwrap_or_default(),
                concealed: false,
            },
            Err(_) => SectionValue::Unsupported,
        },
        // Unix seconds, shown as a calendar date.
        "date" => match serde_json::from_str::<i64>(raw.get())
            .ok()
            .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        {
            Some(date) => SectionValue::Text {
                value: Secret::new(date.format("%Y-%m-%d").to_string()),
                concealed: false,
            },
            None => SectionValue::Unsupported,
        },
        "monthYear" => match serde_json::from_str::<u32>(raw.get()) {
            // `YYYYMM`, shown the way cards print it.
            Ok(month_year) => SectionValue::Text {
                value: Secret::new(format!("{:02}/{}", month_year % 100, month_year / 100)),
                concealed: false,
            },
            Err(_) => SectionValue::Unsupported,
        },
        "address" => match serde_json::from_str::<AddressValue>(raw.get()) {
            Ok(address) => {
                let parts = [
                    &address.street,
                    &address.city,
                    &address.state,
                    &address.zip,
                    &address.country,
                ];
                let value = Secret::join(
                    parts.into_iter().flatten().map(Secret::expose_secret),
                    ", ",
                );
                SectionValue::Text { value, concealed: false }
            }
            Err(_) => SectionValue::Unsupported,
        },
        "sshKey" => match serde_json::from_str::<SshKeyValue>(raw.get()) {
            Ok(key) => SectionValue::SshKey(key),
            Err(_) => SectionValue::Unsupported,
        },
        "file" => SectionValue::Attachment,
        // A link to another item, meaningless outside 1Password.
        "reference" => SectionValue::Unsupported,
        // Unknown value types are kept when they are plain text.
        _ => text(false),
    }
}

fn add_section_field(
    draft: &mut Draft,
    category: Category,
    id: &str,
    label: &str,
    value_type: &str,
    raw: &RawValue,
    name_parts: &mut NameParts,
) {
    let (value, concealed) = match decode(value_type, raw) {
        SectionValue::Text { value, concealed } => (value, concealed),
        SectionValue::OneTimePassword(value) => return draft.one_time_password(value),
        SectionValue::Url(value) => {
            return draft.add_labeled_url(Some(label.to_owned()), value.expose_secret());
        }
        SectionValue::SshKey(key) => return add_ssh_key(draft, key, label),
        SectionValue::Attachment => return draft.drop_part(DroppedPart::Attachment, 1),
        SectionValue::Unsupported => return draft.drop_part(DroppedPart::ExtraField, 1),
    };

    match (category, id) {
        (Category::Login, "username" | "pop_username") => draft.username(value, label),
        (Category::Login, "password" | "pop_password") => draft.password(value, label),
        (Category::Login, "url" | "hostname" | "server") => {
            draft.add_labeled_url(Some(label.to_owned()), value.expose_secret());
        }
        (Category::Card, "cardholder") => draft.username(value, label),
        (Category::Card, "ccnum") => draft.password(value, label),
        (Category::Card, "expiry") => draft.field(draft::EXPIRES, value, false),
        (Category::Card, "cvv") => draft.field(draft::SECURITY_CODE, value, true),
        (Category::Identity, "firstname") => name_parts.first = value,
        (Category::Identity, "initial") => name_parts.initial = value,
        (Category::Identity, "lastname") => name_parts.last = value,
        (Category::Identity, "fullname" | "name" | "member_name") => draft.username(value, label),
        (Category::Identity, "email") => draft.field(draft::EMAIL, value, false),
        (Category::Identity, "defphone" | "cellphone" | "homephone" | "busphone") => {
            draft.field(draft::PHONE, value, false);
        }
        (Category::Identity, "address") => draft.field(draft::ADDRESS, value, false),
        (Category::Api, "credential") => draft.password(value, label),
        (Category::Api, "username") => draft.username(value, label),
        (Category::Api, "hostname") => {
            draft.add_labeled_url(Some(label.to_owned()), value.expose_secret());
        }
        _ => draft.field(label, value, concealed),
    }
}

fn add_ssh_key(draft: &mut Draft, key: SshKeyValue, label: &str) {
    if let Some(private_key) = key.private_key {
        draft.password(private_key, label);
    }

    let Some(metadata) = key.metadata else {
        return;
    };
    if let Some(public_key) = metadata.public_key {
        draft.username(public_key, "Public key");
    }
    if let Some(fingerprint) = metadata.fingerprint {
        draft.field("Fingerprint", fingerprint, false);
    }
    if let Some(key_type) = metadata.key_type {
        draft.field("Key type", key_type, false);
    }
}
