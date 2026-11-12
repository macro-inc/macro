//! Format-independent item assembly. Parsers fill a [`Draft`]; `finish`
//! applies the vault's limits so the preview counts what will really land.
use std::collections::BTreeSet;

use crate::model::{
    Dropped, DroppedPart, FolderPath, SegmentTooLong, ImportedField, ImportedItem, ItemKind, ParsedExport,
    Secret, SkipReason, Skipped, SourceFormat, SourceKey,
};
use crate::totp;

const MAX_NAME_BYTES: usize = 200;
const MAX_LABEL_BYTES: usize = 200;
const MAX_VALUE_BYTES: usize = 65_536;
const MAX_FIELDS: usize = 50;
const MAX_URL_BYTES: usize = 2048;

const UNTITLED: &str = "Untitled";
const UNLABELED: &str = "Field";
const WEBSITE: &str = "Website";
const ONE_TIME_PASSWORD: &str = "One-time password";
const TAGS: &str = "Tags";

/// Template field labels, matching the web app's item templates.
pub(crate) const EXPIRES: &str = "Expires";
pub(crate) const SECURITY_CODE: &str = "Security code";
pub(crate) const EMAIL: &str = "Email";
pub(crate) const PHONE: &str = "Phone";
pub(crate) const ADDRESS: &str = "Address";

/// A URL from the source. Unlabeled ones that don't become the item URL are
/// kept as `Website`, `Website 2`, ...; labeled ones keep their label.
struct UrlCandidate {
    label: Option<String>,
    value: String,
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
    folder: Result<Option<FolderPath>, SegmentTooLong>,
    favorite: bool,
    tags: Vec<String>,
    dropped: Vec<(DroppedPart, usize)>,
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
            folder: Ok(None),
            favorite: false,
            tags: Vec::new(),
            dropped: Vec::new(),
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

    pub(crate) fn set_folder(&mut self, folder: Result<Option<FolderPath>, SegmentTooLong>) {
        self.folder = folder;
    }

    pub(crate) fn add_tag(&mut self, tag: &str) {
        let tag = tag.trim();
        if !tag.is_empty() {
            self.tags.push(tag.to_owned());
        }
    }

    pub(crate) fn add_url(&mut self, url: &str) {
        self.add_labeled_url(None, url);
    }

    /// A URL-ish value with its own label (`Hostname`), kept under that label
    /// when it isn't the item URL.
    pub(crate) fn add_labeled_url(&mut self, label: Option<String>, url: &str) {
        let url = url.trim();
        let already_listed = self.urls.iter().any(|candidate| candidate.value == url);

        if !url.is_empty() && !already_listed {
            self.urls.push(UrlCandidate {
                label,
                value: url.to_owned(),
            });
        }
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

    /// Use `value` as the username, or keep it as a field when one is set.
    pub(crate) fn username(&mut self, value: Secret, label: &str) {
        if self.username.is_empty() {
            self.username = value;
        } else {
            self.field(label, value, false);
        }
    }

    /// Use `value` as the password, or keep it as a concealed field when one is set.
    pub(crate) fn password(&mut self, value: Secret, label: &str) {
        if self.password.is_empty() {
            self.password = value;
        } else {
            self.field(label, value, true);
        }
    }

    pub(crate) fn notes(&mut self, value: Secret) {
        self.notes = value;
    }

    /// A custom field; empty values are left out.
    pub(crate) fn field(&mut self, label: &str, value: Secret, concealed: bool) {
        if value.expose_secret().trim().is_empty() {
            return;
        }

        self.fields.push(ImportedField {
            label: label.to_owned(),
            value,
            concealed,
        });
    }

    pub(crate) fn one_time_password(&mut self, value: Secret) {
        if !value.expose_secret().trim().is_empty() {
            self.one_time_passwords.push(value);
        }
    }

    pub(crate) fn drop_part(&mut self, what: DroppedPart, count: usize) {
        if count == 0 {
            return;
        }

        match self.dropped.iter_mut().find(|(part, _)| *part == what) {
            Some((_, existing)) => *existing += count,
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
            Some(name) if name.len() > MAX_NAME_BYTES => {
                return Err(self.skipped(SkipReason::TooLarge));
            }
            Some(name) => name.to_owned(),
        };

        let Ok(folder) = std::mem::replace(&mut self.folder, Ok(None)) else {
            return Err(self.skipped(SkipReason::TooLarge));
        };

        let url = self.place_urls();
        let totp = self.place_one_time_passwords();

        if !self.tags.is_empty() {
            let tags = Secret::join(self.tags.iter().map(String::as_str), ", ");
            self.field(TAGS, tags, false);
        }

        for field in &mut self.fields {
            let label = field.label.trim();
            field.label = if label.is_empty() {
                UNLABELED.to_owned()
            } else {
                label.to_owned()
            };
        }

        let over_limit = self.username.len() > MAX_VALUE_BYTES
            || self.password.len() > MAX_VALUE_BYTES
            || self.notes.len() > MAX_VALUE_BYTES
            || self.fields.len() > MAX_FIELDS
            || self.fields.iter().any(|field| {
                field.label.len() > MAX_LABEL_BYTES || field.value.len() > MAX_VALUE_BYTES
            });
        if over_limit {
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

        let item = ImportedItem {
            source_key: self.source_key,
            kind: self.kind,
            name,
            url,
            username: self.username,
            password: self.password,
            notes: self.notes,
            fields: self.fields,
            totp,
            folder,
            favorite: self.favorite,
        };

        Ok((item, dropped))
    }

    /// The first valid URL becomes the item URL; the rest become fields.
    fn place_urls(&mut self) -> Option<String> {
        let candidates = std::mem::take(&mut self.urls);
        let url_index = candidates
            .iter()
            .position(|candidate| is_vault_url(&candidate.value));

        let mut website_number = if url_index.is_some() { 2 } else { 1 };
        let mut url = None;

        for (index, candidate) in candidates.into_iter().enumerate() {
            if Some(index) == url_index {
                url = Some(candidate.value);
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
            self.field(&label, Secret::new(candidate.value), false);
        }

        url
    }

    /// The first default TOTP becomes the code; others stay concealed fields.
    fn place_one_time_passwords(&mut self) -> Option<crate::TotpSeed> {
        let mut seed = None;

        for raw in std::mem::take(&mut self.one_time_passwords) {
            if seed.is_none() {
                seed = totp::default_seed(raw.expose_secret());
                if seed.is_some() {
                    continue;
                }
            }

            self.field(ONE_TIME_PASSWORD, raw, true);
            self.drop_part(DroppedPart::TotpNonDefault, 1);
        }

        seed
    }
}

fn valid_name(name: Option<&str>) -> Option<String> {
    let name = name?.trim();
    let valid = !name.is_empty() && name.len() <= MAX_NAME_BYTES;
    valid.then(|| name.to_owned())
}

/// The vault's login URL rule: http(s), a host, no credentials.
fn is_vault_url(value: &str) -> bool {
    if value.len() > MAX_URL_BYTES {
        return false;
    }

    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };

    matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(|host| !host.is_empty())
        && parsed.username().is_empty()
        && parsed.password().is_none()
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

    pub(crate) fn skip(&mut self, source_key: Option<SourceKey>, name: Option<&str>, reason: SkipReason) {
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
