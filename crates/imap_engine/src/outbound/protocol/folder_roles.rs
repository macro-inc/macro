//! Resolve selectable mailbox roles from RFC 6154 and imapflow's localized names.
use crate::domain::{
    account_settings::FolderPreferences,
    models::{Folder, FolderRole, MAX_MONITORED_FOLDERS},
};
use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use imap_proto::NameAttribute;
use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;

mod names;

/// Source strength and hierarchy depth rank competing physical folders.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Priority {
    source: u8,
    depth: std::cmp::Reverse<usize>,
}

/// Decode a display path. Callers retain the listed octets for every wire command.
pub(super) fn display_path(path: &str) -> String {
    let mut value = String::with_capacity(path.len());
    let mut rest = path;
    while let Some((prefix, suffix)) = rest.split_once('&') {
        let Some((shifted, remaining)) = suffix.split_once('-') else {
            break;
        };
        value.push_str(prefix);
        if shifted.is_empty() {
            value.push('&');
        } else {
            let decoded = STANDARD_NO_PAD
                .decode(shifted.replace(',', "/"))
                .ok()
                .filter(|bytes| bytes.len() % 2 == 0)
                .and_then(|bytes| {
                    char::decode_utf16(
                        bytes
                            .chunks_exact(2)
                            .map(|w| u16::from_be_bytes([w[0], w[1]])),
                    )
                    .collect::<Result<String, _>>()
                    .ok()
                });
            match decoded {
                Some(s) => value.push_str(&s),
                None => {
                    value.push('&');
                    value.push_str(shifted);
                    value.push('-');
                }
            }
        }
        rest = remaining;
    }
    value.push_str(rest);
    value
}

/// Encode a newly supplied UTF-8 label for a server using IMAP modified UTF-7.
pub(super) fn wire_path(display: &str) -> String {
    fn flush(bytes: &mut Vec<u8>, out: &mut String) {
        if bytes.is_empty() {
            return;
        }
        out.push('&');
        out.push_str(&STANDARD_NO_PAD.encode(&*bytes).replace('/', ","));
        out.push('-');
        bytes.clear();
    }
    let mut result = String::new();
    let mut bytes = Vec::new();
    for ch in display.chars() {
        if (' '..='~').contains(&ch) {
            flush(&mut bytes, &mut result);
            result.push(ch);
            if ch == '&' {
                result.push('-');
            }
        } else {
            for word in ch.encode_utf16(&mut [0; 2]) {
                bytes.extend_from_slice(&word.to_be_bytes());
            }
        }
    }
    flush(&mut bytes, &mut result);
    result
}

fn lookup(name: &str) -> Option<FolderRole> {
    names::NAMES
        .binary_search_by_key(&name, |(name, _)| *name)
        .ok()
        .map(|i| names::NAMES[i].1)
}

pub(super) fn detect(
    path: &str,
    delimiter: Option<&str>,
    attrs: &[NameAttribute<'_>],
) -> (FolderRole, Priority) {
    let path = display_path(path);
    let d = delimiter.filter(|d| !d.is_empty());
    let depth = d.map_or(0, |d| path.matches(d).count());
    let priority = |source| Priority {
        source,
        depth: std::cmp::Reverse(depth),
    };
    if path.eq_ignore_ascii_case("INBOX") {
        return (FolderRole::Inbox, priority(4));
    }
    for (flag, role) in [
        (NameAttribute::Archive, FolderRole::Archive),
        (NameAttribute::Drafts, FolderRole::Drafts),
        (NameAttribute::Junk, FolderRole::Junk),
        (NameAttribute::Sent, FolderRole::Sent),
        (NameAttribute::Trash, FolderRole::Trash),
    ] {
        if attrs.contains(&flag) {
            return (role, priority(3));
        }
    }
    // All Mail and Flagged are virtual; their display names cannot elect a filing destination.
    if attrs.contains(&NameAttribute::All) || attrs.contains(&NameAttribute::Flagged) {
        return (FolderRole::Other, priority(3));
    }
    let name = d
        .and_then(|d| path.rsplit_once(d).map(|(_, n)| n))
        .unwrap_or(&path)
        .trim()
        .replace(['\u{200e}', '\u{200f}'], "")
        .to_lowercase()
        .nfkc()
        .collect::<String>();
    if let Some(role) = lookup(&name) {
        return (role, priority(2));
    }
    let mut core = name
        .split(|c: char| c.is_whitespace() || "-_/.,()[]".contains(c))
        .filter(|t| !t.is_empty() && names::GENERIC_TOKENS.binary_search(t).is_err());
    if let Some(first) = core.next()
        && core.next().is_none()
        && let Some(role) = lookup(first)
    {
        return (role, priority(1));
    }
    (FolderRole::Other, priority(0))
}

/// Each semantic role has one automatic destination. User overrides apply afterwards.
pub(super) fn unique_roles(folders: &mut [(Folder, String)], priorities: &[Priority]) {
    for role in [
        FolderRole::Sent,
        FolderRole::Archive,
        FolderRole::Trash,
        FolderRole::Drafts,
        FolderRole::Junk,
    ] {
        let winner = folders
            .iter()
            .zip(priorities)
            .enumerate()
            .filter(|(_, ((f, _), _))| f.role == role)
            .max_by(|(_, ((_, p), r)), (_, ((_, q), s))| r.cmp(s).then_with(|| q.cmp(p)))
            .map(|(i, _)| i);
        for (i, (folder, _)) in folders.iter_mut().enumerate() {
            if folder.role == role && Some(i) != winner {
                folder.role = FolderRole::Other;
            }
        }
    }
}

/// Select the ordinary folders to scan. Listing order cannot displace a monitored role.
pub(super) fn monitored_ids(
    catalog: &[(Folder, String)],
    prefs: &FolderPreferences,
) -> BTreeSet<String> {
    let mut candidates = Vec::new();
    for (folder, path) in catalog {
        let role = prefs.role(folder);
        if !prefs.syncs(&folder.id) || role == FolderRole::Drafts {
            continue;
        }
        let rank = if role == FolderRole::Inbox {
            0
        } else if prefs.watched_folder_ids.contains(&folder.id) {
            1
        } else if role != FolderRole::Other {
            2
        } else if prefs.role_overrides.contains_key(&folder.id) {
            3
        } else {
            4
        };
        candidates.push((rank, path, &folder.id));
    }
    candidates.sort_unstable();
    candidates
        .into_iter()
        .take(MAX_MONITORED_FOLDERS)
        .map(|(_, _, id)| id.clone())
        .collect()
}

#[cfg(test)]
mod test;
