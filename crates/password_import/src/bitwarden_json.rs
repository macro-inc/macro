//! Bitwarden unencrypted JSON: `{ encrypted, folders: [{id, name}], items }`.
//! Items have `type` 1–5 (login, note, card, identity, SSH key), `login`,
//! `card`, `identity`, `sshKey`, `fields: [{name, value, type 0–3}]`,
//! `organizationId`, `collectionIds`, `deletedDate`, `archivedDate`,
//! `passwordHistory` and `attachments`. Folder names nest with `/`.
//! `encrypted: true` fails with `EncryptedBitwarden`.
use std::collections::HashMap;

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::value::RawValue;

use crate::bounded::{Bounded, Count};
use crate::draft::{self, Draft, Parts};
use crate::error::ImportError;
use crate::model::{DroppedPart, FolderPath, ItemKind, Limits, Secret, SkipReason, SourceKey};

#[derive(Deserialize)]
pub(crate) struct Envelope {
    pub(crate) encrypted: Option<bool>,
    pub(crate) items: Option<IgnoredAny>,
}

/// Whether the export is encrypted, and its list sizes, counted before
/// anything is kept.
#[derive(Deserialize)]
struct Shape {
    encrypted: Option<bool>,
    folders: Option<Count<IgnoredAny>>,
    items: Option<Count<IgnoredAny>>,
}

#[derive(Deserialize)]
struct Export<'a> {
    folders: Option<Vec<Folder>>,
    #[serde(borrow)]
    items: Option<Vec<&'a RawValue>>,
}

#[derive(Deserialize)]
struct Folder {
    id: Option<String>,
    name: Option<String>,
}

/// Bitwarden's cipher types.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ItemType {
    Login,
    SecureNote,
    Card,
    Identity,
    SshKey,
    Unknown,
}

impl From<u8> for ItemType {
    fn from(value: u8) -> Self {
        match value {
            1 => Self::Login,
            2 => Self::SecureNote,
            3 => Self::Card,
            4 => Self::Identity,
            5 => Self::SshKey,
            _ => Self::Unknown,
        }
    }
}

/// Bitwarden's custom field types.
#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldType {
    Text,
    Hidden,
    Boolean,
    /// Points at another field of the item; no value of its own.
    Linked,
    Unknown,
}

impl From<u8> for FieldType {
    fn from(value: u8) -> Self {
        match value {
            0 => Self::Text,
            1 => Self::Hidden,
            2 => Self::Boolean,
            3 => Self::Linked,
            _ => Self::Unknown,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: Option<String>,
    organization_id: Option<String>,
    collection_ids: Option<Vec<IgnoredAny>>,
    folder_id: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<u8>,
    name: Option<String>,
    notes: Option<Secret>,
    favorite: Option<bool>,
    #[serde(default)]
    fields: Bounded<Field>,
    login: Option<Login>,
    card: Option<Card>,
    identity: Option<Identity>,
    ssh_key: Option<SshKey>,
    password_history: Option<Vec<IgnoredAny>>,
    attachments: Option<Vec<IgnoredAny>>,
    deleted_date: Option<IgnoredAny>,
    archived_date: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct Field {
    name: Option<String>,
    value: Option<Secret>,
    #[serde(rename = "type")]
    field_type: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Login {
    // Older mobile exports write `"uris": null` for a login without one.
    #[serde(default, deserialize_with = "null_as_empty")]
    uris: Bounded<Uri>,
    username: Option<Secret>,
    password: Option<Secret>,
    totp: Option<Secret>,
    fido2_credentials: Option<Vec<IgnoredAny>>,
}

#[derive(Deserialize)]
struct Uri {
    uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Card {
    cardholder_name: Option<Secret>,
    brand: Option<Secret>,
    number: Option<Secret>,
    exp_month: Option<Secret>,
    exp_year: Option<Secret>,
    code: Option<Secret>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    title: Option<Secret>,
    first_name: Option<Secret>,
    middle_name: Option<Secret>,
    last_name: Option<Secret>,
    address1: Option<Secret>,
    address2: Option<Secret>,
    address3: Option<Secret>,
    city: Option<Secret>,
    state: Option<Secret>,
    postal_code: Option<Secret>,
    country: Option<Secret>,
    company: Option<Secret>,
    email: Option<Secret>,
    phone: Option<Secret>,
    ssn: Option<Secret>,
    username: Option<Secret>,
    passport_number: Option<Secret>,
    license_number: Option<Secret>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshKey {
    private_key: Option<Secret>,
    public_key: Option<Secret>,
    key_fingerprint: Option<Secret>,
}

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let bytes = crate::strip_byte_order_mark(bytes);
    // Count first: two bytes of `[0,0,...]` would otherwise become a kept
    // entry each, before any limit applied.
    let shape: Shape = serde_json::from_slice(bytes).map_err(|error| ImportError::json(&error))?;
    if shape.encrypted == Some(true) {
        return Err(ImportError::EncryptedBitwarden);
    }
    let entries = [shape.folders, shape.items]
        .into_iter()
        .flatten()
        .fold(0, |total: usize, count| total.saturating_add(count.total));
    if entries > limits.max_items {
        return Err(ImportError::TooManyItems);
    }

    let export: Export<'_> =
        serde_json::from_slice(bytes).map_err(|error| ImportError::json(&error))?;
    let items = export.items.ok_or(ImportError::UnsupportedVersion)?;

    let folders: HashMap<String, String> = export
        .folders
        .unwrap_or_default()
        .into_iter()
        .filter_map(|folder| Some((folder.id?, folder.name?)))
        .collect();

    let mut parts = Parts::default();
    for (index, raw) in items.iter().enumerate() {
        match serde_json::from_str::<Item>(raw.get()) {
            Ok(item) => add_item(&mut parts, item, index, &folders),
            Err(_) => parts.skip(
                Some(SourceKey::of_malformed(raw, &[], index)),
                None,
                SkipReason::Malformed,
            ),
        }
    }

    Ok(parts)
}

fn add_item(parts: &mut Parts, item: Item, index: usize, folders: &HashMap<String, String>) {
    let key = SourceKey::from_scoped_id_or_index(&[], item.id.as_deref(), index);
    let name = item.name.as_deref();

    if item.deleted_date.is_some() {
        return parts.skip(Some(key), name, SkipReason::Trashed);
    }
    if item.archived_date.is_some() {
        return parts.skip(Some(key), name, SkipReason::Archived);
    }

    let in_collection = item
        .collection_ids
        .as_ref()
        .is_some_and(|collections| !collections.is_empty());
    if item.organization_id.is_some() || in_collection {
        return parts.skip(Some(key), name, SkipReason::SharedCollection);
    }

    let kind = match item.item_type.map_or(ItemType::Unknown, ItemType::from) {
        ItemType::Login => ItemKind::Login,
        ItemType::SecureNote => ItemKind::Note,
        ItemType::Card => ItemKind::Card,
        ItemType::Identity => ItemKind::Identity,
        ItemType::SshKey => ItemKind::Api,
        ItemType::Unknown => {
            return parts.skip(Some(key), name, SkipReason::UnsupportedCategory);
        }
    };

    let mut draft = Draft::new(key, kind);
    draft.set_name(item.name);
    draft.set_favorite(item.favorite == Some(true));
    if let Some(folder) = item.folder_id.and_then(|id| folders.get(&id)) {
        // Bitwarden nests folders by name: `Work/Clients`.
        draft.set_folder(FolderPath::parse(folder.split('/')));
    }
    if let Some(notes) = item.notes {
        draft.set_notes(notes);
    }

    match kind {
        ItemKind::Login => {
            if let Some(login) = item.login {
                add_login(&mut draft, login);
            }
        }
        ItemKind::Card => {
            if let Some(card) = item.card {
                add_card(&mut draft, card);
            }
        }
        ItemKind::Identity => {
            if let Some(identity) = item.identity {
                add_identity(&mut draft, identity);
            }
        }
        ItemKind::Api => {
            if let Some(key) = item.ssh_key {
                add_ssh_key(&mut draft, key);
            }
        }
        ItemKind::Note | ItemKind::VerificationCode => {}
    }

    if item.fields.overflowed {
        draft.mark_too_large();
    }
    for field in item.fields.entries {
        let field_type = field.field_type.map_or(FieldType::Text, FieldType::from);
        let concealed = match field_type {
            FieldType::Linked => {
                draft.drop_part(DroppedPart::ExtraField, 1);
                continue;
            }
            FieldType::Hidden => true,
            FieldType::Text | FieldType::Boolean | FieldType::Unknown => false,
        };

        let label = field.name.as_deref().unwrap_or_default();
        draft.add_field(label, field.value.unwrap_or_default(), concealed);
    }

    let history = item.password_history.map_or(0, |history| history.len());
    draft.drop_part(DroppedPart::PasswordHistory, history);
    let attachments = item.attachments.map_or(0, |attachments| attachments.len());
    draft.drop_part(DroppedPart::Attachment, attachments);

    parts.add(draft);
}

fn add_login(draft: &mut Draft, login: Login) {
    if login.uris.overflowed {
        draft.mark_too_large();
    }
    for uri in login.uris.entries {
        if let Some(uri) = uri.uri {
            draft.add_url(&uri);
        }
    }

    if let Some(username) = login.username {
        draft.add_username(username);
    }
    if let Some(password) = login.password {
        draft.add_password(password);
    }
    if let Some(totp) = login.totp {
        draft.add_one_time_password(totp);
    }

    let passkeys = login.fido2_credentials.map_or(0, |passkeys| passkeys.len());
    draft.drop_part(DroppedPart::Passkey, passkeys);
}

fn add_card(draft: &mut Draft, card: Card) {
    if let Some(cardholder) = card.cardholder_name {
        draft.add_username_labeled(cardholder, "Cardholder name");
    }
    if let Some(number) = card.number {
        draft.add_password_labeled(number, "Number");
    }

    let month = card.exp_month.unwrap_or_default();
    let year = card.exp_year.unwrap_or_default();
    // `MM/YYYY`, matching 1Password's expiry.
    let month = if month.len() == 1 {
        Secret::join(["0", month.expose_secret()], "")
    } else {
        month
    };
    let expires = Secret::join([month.expose_secret(), year.expose_secret()], "/");
    draft.add_field(draft::EXPIRES, expires, false);

    if let Some(code) = card.code {
        draft.add_field(draft::SECURITY_CODE, code, true);
    }
    if let Some(brand) = card.brand {
        draft.add_field("Brand", brand, false);
    }
}

fn add_identity(draft: &mut Draft, identity: Identity) {
    draft.add_full_name(
        [
            &identity.first_name,
            &identity.middle_name,
            &identity.last_name,
        ]
        .into_iter()
        .flatten()
        .map(Secret::expose_secret),
    );

    if let Some(email) = identity.email {
        draft.add_field(draft::EMAIL, email, false);
    }
    if let Some(phone) = identity.phone {
        draft.add_field(draft::PHONE, phone, false);
    }

    let address = [
        &identity.address1,
        &identity.address2,
        &identity.address3,
        &identity.city,
        &identity.state,
        &identity.postal_code,
        &identity.country,
    ];
    let address = draft::address_text(address.into_iter().flatten().map(Secret::expose_secret));
    draft.add_field(draft::ADDRESS, address, false);

    let rest = [
        ("Title", identity.title, false),
        ("Company", identity.company, false),
        ("Username", identity.username, false),
        ("Social security number", identity.ssn, true),
        ("Passport number", identity.passport_number, true),
        ("License number", identity.license_number, true),
    ];
    for (label, value, concealed) in rest {
        if let Some(value) = value {
            draft.add_field(label, value, concealed);
        }
    }
}

fn add_ssh_key(draft: &mut Draft, key: SshKey) {
    draft.add_ssh_key(
        key.private_key,
        "Private key",
        key.public_key,
        key.key_fingerprint,
    );
}

/// An explicit `null` reads as the empty value, as an absent field does.
fn null_as_empty<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}
