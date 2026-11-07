//! Bitwarden zip export: `data.json` is the JSON export; each item's files are
//! `attachments/<item id>/<file>`. Attachments are counted by entry name and
//! reported as dropped, never inflated.
use crate::draft::Parts;
use crate::error::ImportError;
use crate::model::Limits;
use crate::{bitwarden_json, zip_archive};

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let data = zip_archive::read_data(bytes, limits, zip_archive::BITWARDEN_DATA)?;
    let attachments = zip_archive::bitwarden_attachment_counts(bytes, limits)?;

    bitwarden_json::parse(&data, limits, &attachments)
}
