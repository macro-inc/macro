#[cfg(test)]
mod test;

macro_rules! define_attachment_filters {
    (
        document_mime_types: [$($document_mime_type:literal,)* ; $last_document_mime_type:literal],
        octet_stream_extensions: [$($extension:literal,)* ; $last_extension:literal],
        media_mime_prefixes: [$first_media_prefix:literal $(, $media_prefix:literal)* $(,)?],
    ) => {
        /// MIME types treated as document attachments.
        pub const DOCUMENT_MIME_TYPES: &[&str] = &[
            $($document_mime_type,)*
            $last_document_mime_type,
        ];

        /// Filename extensions treated as documents for octet-stream attachments.
        pub const OCTET_STREAM_DOCUMENT_EXTENSIONS: &[&str] = &[
            $($extension,)*
            $last_extension,
        ];

        /// MIME type prefixes treated as media attachments.
        pub const MEDIA_MIME_PREFIXES: &[&str] = &[
            $first_media_prefix,
            $($media_prefix,)*
        ];

        /// SQL filter for document attachments.
        pub const ATTACHMENT_MIME_TYPE_FILTERS: &str = concat!(
            "\n    AND (\n",
            "        a.mime_type IN (\n",
            $("            '", $document_mime_type, "',\n",)*
            "            '", $last_document_mime_type, "'\n",
            "        )\n",
            "        OR (\n",
            "            a.mime_type = 'application/octet-stream' \n",
            "            AND UPPER(SUBSTRING(a.filename FROM '\\.([^.]+)$')) IN (",
            $("'", $extension, "', ",)*
            "'", $last_extension, "')\n",
            "        )\n",
            "    )\n",
        );

        /// SQL filter for media attachments.
        pub const ATTACHMENT_MIME_TYPE_FILTERS_WITH_MEDIA: &str = concat!(
            "\n    (a.mime_type LIKE '", $first_media_prefix, "%'",
            $(" OR a.mime_type LIKE '", $media_prefix, "%'",)*
            ")\n",
        );
    };
}

define_attachment_filters! {
    document_mime_types: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "text/html",
        "text/plain",
        ; "pdf"
    ],
    octet_stream_extensions: ["PDF", "DOC", "DOCX", "TXT", ; "HTML"],
    media_mime_prefixes: ["image/", "video/"],
}

/// Returns whether an attachment matches the document filter.
pub fn attachment_is_document(mime_type: &str, filename: Option<&str>) -> bool {
    let Some(filename) = filename else {
        return false;
    };

    if DOCUMENT_MIME_TYPES.contains(&mime_type) {
        return true;
    }

    if mime_type != "application/octet-stream" {
        return false;
    }

    filename
        .rsplit_once('.')
        .map(|(_, extension)| {
            OCTET_STREAM_DOCUMENT_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

/// Returns whether an attachment matches the media filter.
pub fn attachment_is_media(mime_type: &str) -> bool {
    MEDIA_MIME_PREFIXES
        .iter()
        .any(|prefix| mime_type.starts_with(prefix))
}

macro_rules! define_attachment_whitelist {
    ($($domain:literal,)* ; $last_domain:literal) => {
        /// Domains whose attachments are always inserted.
        pub const ATTACHMENT_WHITELIST_DOMAINS: &[&str] = &[
            $($domain,)*
            $last_domain,
        ];

        /// SQL predicate for attachments sent from whitelisted domains.
        pub const ATTACHMENT_WHITELISTED_DOMAINS: &str = concat!(
            "\n                        OR (\n",
            "                            -- condition 4: email from whitelisted domain\n",
            "                            c.email_address IS NOT NULL\n",
            "                            AND LOWER(SPLIT_PART(c.email_address, '@', 2)) IN (\n",
            $("                                '", $domain, "',\n",)*
            "                                '", $last_domain, "'\n",
            "                            )\n",
            "                        )",
        );
    };
}

define_attachment_whitelist! {
    "docusign.com",
    "hellosign.com",
    "dropboxsign.com",
    "adobesign.com",
    "signnow.com",
    "pandadoc.com",
    "quickbooks.com",
    "xero.com",
    "stripe.com",
    "paypal.com",
    "squareup.com",
    "bill.com",
    "gusto.com",
    "justworks.com",
    "rippling.com",
    "intuit.com",
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "capitalone.com",
    "amex.com",
    "citibank.com",
    "robinhood.com",
    "etrade.com",
    "fidelity.com",
    "schwab.com",
    "interactivebrokers.com",
    "vanguard.com",
    "plaid.com",
    "irs.gov",
    "ssa.gov",
    "uscis.gov",
    "treasury.gov",
    "efiletexas.gov",
    "efilemanager.com",
    "efile.ca.gov",
    "sec.gov",
    "greenhouse.io",
    "lever.co",
    "bamboohr.com",
    "workday.com",
    "sap.com",
    "indeed.com",
    "linkedin.com",
    "ziprecruiter.com",
    "docusign.net",
    "dropbox.com",
    "box.com",
    "drive.google.com",
    "sharepoint.com",
    "onedrive.live.com",
    "wetransfer.com",
    "figma.com",
    "canva.com",
    "notion.so",
    "clickup.com",
    "airtable.com",
    "unitedhealthcare.com",
    "aetna.com",
    "cigna.com",
    "metlife.com",
    "anthem.com",
    "oscarhealth.com",
    "delta-dental.com",
    "vanguardbenefits.com",
    "fidelitybenefits.com",
    "aws.amazon.com",
    "cloudflare.com",
    "digitalocean.com",
    "github.com",
    "gitlab.com",
    "atlassian.com",
    "openai.com",
    ; "anthropic.com"
}
