//! Format-independent item assembly. Parsers fill a [`Draft`]; `finish`
//! applies the vault's limits so the preview counts what will really land.
use std::collections::BTreeSet;

use crate::model::{
    Dropped, DroppedPart, FolderPath, ImportedField, ImportedItem, ItemKind, ParsedExport, Secret,
    SkipReason, Skipped, SourceFolder, SourceFormat, SourceKey, TotpSeed,
};
use crate::{totp, vault};

const UNTITLED: &str = "Untitled";
const UNLABELED: &str = "Field";
const WEBSITE: &str = "Website";
const ONE_TIME_PASSWORD: &str = "One-time password";
const TAGS: &str = "Tags";
const USERNAME: &str = "Username";
const PASSWORD: &str = "Password";
const NAME: &str = "Name";
const PUBLIC_KEY: &str = "Public key";
const FINGERPRINT: &str = "Fingerprint";
const NAME_SEPARATOR: &str = " ";
const ADDRESS_SEPARATOR: &str = ", ";

/// Template field labels, matching the web app's item templates.
pub(crate) const EXPIRES: &str = "Expires";
pub(crate) const SECURITY_CODE: &str = "Security code";
pub(crate) const EMAIL: &str = "Email";
pub(crate) const PHONE: &str = "Phone";
pub(crate) const ADDRESS: &str = "Address";

/// Distinct URLs (or one-time passwords) worth keeping: one for the item plus
/// one field per vault field. One more always makes the item too large, so
/// later ones aren't compared.
const MAX_URLS: usize = vault::MAX_FIELDS + 1;
/// JSON around each field and around the item, beyond the strings themselves.
const FIELD_JSON_OVERHEAD: usize = 64;
const ITEM_JSON_OVERHEAD: usize = 512;

/// A URL from the source. Unlabeled ones that don't become the item URL are
/// kept as `Website`, `Website 2`, ...; labeled ones keep their label.
struct UrlCandidate {
    label: Option<String>,
    value: Secret,
    concealed: bool,
}

/// An item as read from the source, before limits.
pub(crate) struct Draft {
    source_key: SourceKey,
    kind: ItemKind,
    name: Option<String>,
    urls: Vec<UrlCandidate>,
    username: Secret,
    password: Secret,
    notes: Secret,
    fields: Vec<ImportedField>,
    one_time_passwords: Vec<Secret>,
    folder: SourceFolder,
    favorite: bool,
    tags: Vec<String>,
    dropped: Vec<(DroppedPart, usize)>,
    /// Something was over a limit before `finish`: a source list, the URLs
    /// or the fields. The item is skipped as too large.
    too_large: bool,
}

impl Draft {
    pub(crate) fn new(source_key: SourceKey, kind: ItemKind) -> Self {
        Self {
            source_key,
            kind,
            name: None,
            urls: Vec::new(),
            username: Secret::default(),
            password: Secret::default(),
            notes: Secret::default(),
            fields: Vec::new(),
            one_time_passwords: Vec::new(),
            folder: SourceFolder::None,
            favorite: false,
            tags: Vec::new(),
            dropped: Vec::new(),
            too_large: false,
        }
    }

    pub(crate) fn set_kind(&mut self, kind: ItemKind) {
        self.kind = kind;
    }

    pub(crate) fn kind(&self) -> ItemKind {
        self.kind
    }

    pub(crate) fn set_name(&mut self, name: Option<String>) {
        self.name = name;
    }

    pub(crate) fn set_favorite(&mut self, favorite: bool) {
        self.favorite = favorite;
    }

    pub(crate) fn set_folder(&mut self, folder: SourceFolder) {
        self.folder = folder;
    }

    /// A source list was cut short (see [`crate::bounded::Bounded`]).
    pub(crate) fn mark_too_large(&mut self) {
        self.too_large = true;
    }

    pub(crate) fn add_tag(&mut self, tag: &str) {
        let tag = tag.trim();
        if !tag.is_empty() {
            self.tags.push(tag.to_owned());
        }
    }

    pub(crate) fn add_url(&mut self, url: &str) {
        self.add_labeled_url(None, url, false);
    }

    /// A URL-ish value with its own label (`Hostname`), kept under that label
    /// when it isn't the item URL; `concealed` when the source hid it.
    pub(crate) fn add_labeled_url(&mut self, label: Option<String>, url: &str, concealed: bool) {
        let url = url.trim();
        if url.is_empty()
            || self
                .urls
                .iter()
                .any(|candidate| candidate.value.expose_secret() == url)
        {
            return;
        }
        if self.urls.len() >= MAX_URLS {
            return self.mark_too_large();
        }

        self.urls.push(UrlCandidate {
            label,
            value: Secret::new(url.to_owned()),
            concealed,
        });
    }

    pub(crate) fn has_username(&self) -> bool {
        !self.username.is_empty()
    }

    pub(crate) fn has_password(&self) -> bool {
        !self.password.is_empty()
    }

    pub(crate) fn has_urls(&self) -> bool {
        !self.urls.is_empty()
    }

    /// Use `value` as the username, or keep it as a `Username` field when one
    /// is set.
    pub(crate) fn add_username(&mut self, value: Secret) {
        self.add_username_labeled(value, USERNAME);
    }

    /// Use `value` as the username, or keep it as a `label` field when one is set.
    pub(crate) fn add_username_labeled(&mut self, value: Secret, label: &str) {
        if self.username.is_empty() {
            self.username = value;
        } else {
            self.add_field(label, value, false);
        }
    }

    /// Use `value` as the password, or keep it as a concealed `Password` field
    /// when one is set.
    pub(crate) fn add_password(&mut self, value: Secret) {
        self.add_password_labeled(value, PASSWORD);
    }

    /// Use `value` as the password, or keep it as a concealed `label` field
    /// when one is set.
    pub(crate) fn add_password_labeled(&mut self, value: Secret, label: &str) {
        if self.password.is_empty() {
            self.password = value;
        } else {
            self.add_field(label, value, true);
        }
    }

    pub(crate) fn set_notes(&mut self, value: Secret) {
        self.notes = value;
    }

    /// A custom field; empty values are left out.
    pub(crate) fn add_field(&mut self, label: &str, value: Secret, concealed: bool) {
        if value.expose_secret().trim().is_empty() {
            return;
        }
        if self.fields.len() >= vault::MAX_FIELDS {
            return self.mark_too_large();
        }

        self.fields.push(ImportedField {
            label: label.to_owned(),
            value,
            concealed,
        });
    }

    pub(crate) fn add_one_time_password(&mut self, value: Secret) {
        if value.expose_secret().trim().is_empty() {
            return;
        }
        // All but one become fields, like URLs.
        if self.one_time_passwords.len() >= MAX_URLS {
            return self.mark_too_large();
        }
        self.one_time_passwords.push(value);
    }

    /// An identity's name from its parts (first, middle, last), as the username.
    pub(crate) fn add_full_name<'a>(&mut self, parts: impl IntoIterator<Item = &'a str>) {
        self.add_username_labeled(Secret::join(parts, NAME_SEPARATOR), NAME);
    }

    /// An SSH key: the private key as the password (or a `private_label`
    /// field), the public key as the username, the fingerprint as a field.
    pub(crate) fn add_ssh_key(
        &mut self,
        private_key: Option<Secret>,
        private_label: &str,
        public_key: Option<Secret>,
        fingerprint: Option<Secret>,
    ) {
        if let Some(private_key) = private_key {
            self.add_password_labeled(private_key, private_label);
        }
        if let Some(public_key) = public_key {
            self.add_username_labeled(public_key, PUBLIC_KEY);
        }
        if let Some(fingerprint) = fingerprint {
            self.add_field(FINGERPRINT, fingerprint, false);
        }
    }

    pub(crate) fn drop_part(&mut self, what: DroppedPart, count: usize) {
        if count == 0 {
            return;
        }

        match self.dropped.iter_mut().find(|(part, _)| *part == what) {
            Some((_, existing)) => *existing = existing.saturating_add(count),
            None => self.dropped.push((what, count)),
        }
    }

    fn has_content(&self) -> bool {
        !self.username.is_empty()
            || !self.password.is_empty()
            || !self.notes.is_empty()
            || !self.fields.is_empty()
            || !self.one_time_passwords.is_empty()
    }

    fn skipped(&self, reason: SkipReason) -> Skipped {
        Skipped {
            source_key: Some(self.source_key.clone()),
            name: valid_name(self.name.as_deref()),
            reason,
        }
    }

    /// Apply vault limits: the item as the vault will store it, or why not.
    pub(crate) fn finish(mut self) -> Result<(ImportedItem, Vec<Dropped>), Skipped> {
        // A passkey-only item has nothing the vault can hold; URLs alone
        // (the passkey's site) don't count as content.
        let passkeys = self
            .dropped
            .iter()
            .any(|(part, _)| *part == DroppedPart::Passkey);
        if passkeys && !self.has_content() {
            return Err(self.skipped(SkipReason::Passkey));
        }

        let name = match self.name.as_deref().map(str::trim) {
            None | Some("") => UNTITLED.to_owned(),
            Some(name) if name.len() > vault::MAX_NAME_BYTES => {
                return Err(self.skipped(SkipReason::TooLarge));
            }
            Some(name) => name.to_owned(),
        };

        let folder = match std::mem::take(&mut self.folder) {
            SourceFolder::None => None,
            SourceFolder::Path(path) => Some(path),
            SourceFolder::OverLimit => return Err(self.skipped(SkipReason::TooLarge)),
        };

        let url = self.place_urls();
        let totp = self.place_one_time_passwords();

        if !self.tags.is_empty() {
            let tags = Secret::join(self.tags.iter().map(String::as_str), ", ");
            self.add_field(TAGS, tags, false);
        }

        for field in &mut self.fields {
            let label = field.label.trim();
            field.label = if label.is_empty() {
                UNLABELED.to_owned()
            } else {
                label.to_owned()
            };
        }

        let over_limit = self.too_large
            || self.username.len() > vault::MAX_VALUE_BYTES
            || self.password.len() > vault::MAX_VALUE_BYTES
            || self.notes.len() > vault::MAX_VALUE_BYTES
            || self.fields.iter().any(|field| {
                field.label.len() > vault::MAX_LABEL_BYTES
                    || field.value.len() > vault::MAX_VALUE_BYTES
            });
        if over_limit {
            return Err(self.skipped(SkipReason::TooLarge));
        }

        let item = ImportedItem {
            source_key: self.source_key.clone(),
            kind: self.kind,
            name,
            url,
            username: std::mem::take(&mut self.username),
            password: std::mem::take(&mut self.password),
            notes: std::mem::take(&mut self.notes),
            fields: std::mem::take(&mut self.fields),
            totp,
            folder,
            favorite: self.favorite,
        };
        if item_json_bytes(&item) > vault::MAX_ITEM_JSON_BYTES {
            return Err(self.skipped(SkipReason::TooLarge));
        }

        let dropped = self
            .dropped
            .into_iter()
            .map(|(what, count)| Dropped {
                source_key: self.source_key.clone(),
                what,
                count,
            })
            .collect();

        Ok((item, dropped))
    }

    /// The first valid URL becomes the item URL; the rest become fields,
    /// concealed when the source hid them or they carry credentials.
    fn place_urls(&mut self) -> Option<String> {
        let candidates = std::mem::take(&mut self.urls);
        let url_index = candidates
            .iter()
            .position(|candidate| vault::is_login_url(candidate.value.expose_secret()));

        let mut website_number = if url_index.is_some() { 2 } else { 1 };
        let mut url = None;

        for (index, candidate) in candidates.into_iter().enumerate() {
            if Some(index) == url_index {
                url = Some(candidate.value.expose_secret().to_owned());
                continue;
            }

            let label = match candidate.label {
                Some(label) => label,
                None if website_number == 1 => {
                    website_number += 1;
                    WEBSITE.to_owned()
                }
                None => {
                    let label = format!("{WEBSITE} {website_number}");
                    website_number += 1;
                    label
                }
            };
            let concealed =
                candidate.concealed || vault::url_has_credentials(candidate.value.expose_secret());
            self.add_field(&label, candidate.value, concealed);
        }

        url
    }

    /// The first default TOTP becomes the code; others stay concealed fields.
    fn place_one_time_passwords(&mut self) -> Option<TotpSeed> {
        let mut seed = None;

        for raw in std::mem::take(&mut self.one_time_passwords) {
            if seed.is_none() {
                seed = totp::default_seed(raw.expose_secret());
                if seed.is_some() {
                    continue;
                }
            }

            self.add_field(ONE_TIME_PASSWORD, raw, true);
            self.drop_part(DroppedPart::TotpNonDefault, 1);
        }

        seed
    }
}

/// Join an address's parts (street, city, ...) into one value.
pub(crate) fn address_text<'a>(parts: impl IntoIterator<Item = &'a str>) -> Secret {
    Secret::join(parts, ADDRESS_SEPARATOR)
}

/// An upper bound on the item's size as JSON in a write request.
fn item_json_bytes(item: &ImportedItem) -> usize {
    let text = |value: &str| vault::json_string_bytes(value);
    let fields: usize = item
        .fields
        .iter()
        .map(|field| text(&field.label) + text(field.value.expose_secret()) + FIELD_JSON_OVERHEAD)
        .sum();
    let folder: usize = item
        .folder
        .iter()
        .flat_map(FolderPath::segments)
        .map(|segment| text(segment))
        .sum();

    ITEM_JSON_OVERHEAD
        + text(&item.name)
        + item.url.as_deref().map_or(0, text)
        + text(item.username.expose_secret())
        + text(item.password.expose_secret())
        + text(item.notes.expose_secret())
        + item
            .totp
            .as_ref()
            .map_or(0, |seed| text(seed.expose_secret()))
        + fields
        + folder
}

fn valid_name(name: Option<&str>) -> Option<String> {
    let name = name?.trim();
    let valid = !name.is_empty() && name.len() <= vault::MAX_NAME_BYTES;
    valid.then(|| name.to_owned())
}

/// Collected results of one file.
#[derive(Default)]
pub(crate) struct Parts {
    items: Vec<ImportedItem>,
    skipped: Vec<Skipped>,
    dropped: Vec<Dropped>,
}

impl Parts {
    pub(crate) fn add(&mut self, draft: Draft) {
        match draft.finish() {
            Ok((item, dropped)) => {
                self.items.push(item);
                self.dropped.extend(dropped);
            }
            Err(skipped) => self.skipped.push(skipped),
        }
    }

    pub(crate) fn skip(
        &mut self,
        source_key: Option<SourceKey>,
        name: Option<&str>,
        reason: SkipReason,
    ) {
        self.skipped.push(Skipped {
            source_key,
            name: valid_name(name),
            reason,
        });
    }

    pub(crate) fn into_export(self, format: SourceFormat) -> ParsedExport {
        let folders: BTreeSet<FolderPath> = self
            .items
            .iter()
            .filter_map(|item| item.folder.as_ref())
            .flat_map(FolderPath::with_ancestors)
            .collect();

        ParsedExport {
            format,
            // BTreeSet order puts every path right before its descendants.
            folders: folders.into_iter().collect(),
            items: self.items,
            skipped: self.skipped,
            dropped: self.dropped,
        }
    }
}

#[cfg(test)]
mod test;
