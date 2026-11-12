use std::fmt;

#[cfg(test)]
mod test;

/// The domain used for first-party Rox mailbox addresses.
pub const ROX_MAIL_DOMAIN: &str = "rox.one";

/// Service and operations names that cannot be claimed as mailbox handles.
pub const RESERVED_HANDLES: &[&str] = &[
    "postmaster",
    "abuse",
    "admin",
    "administrator",
    "root",
    "support",
    "noreply",
    "no-reply",
    "dmarc",
    "security",
    "hostmaster",
    "webmaster",
    "mailer-daemon",
    "info",
    "billing",
    "help",
    "rox",
    "team",
    "system",
    "mail",
    "www",
    "api",
    "mx",
    "smtp",
    "imap",
    "jmap",
    "autoconfig",
    "autodiscover",
    "mta-sts",
    "sales",
    "legal",
    "privacy",
    "news",
    "newsletter",
    "bounce",
    "bounces",
    "devnull",
    "nobody",
    "test",
    "official",
    "staff",
    "owner",
];

/// A validated, lowercase local part of a first-party mailbox address.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MailboxHandle(String);

/// A handle does not satisfy the Rox mailbox grammar or is reserved.
#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
#[error("invalid or reserved mailbox handle")]
pub struct InvalidMailboxHandle;

impl MailboxHandle {
    /// Validates `[a-z0-9._-]`, 3–32 bytes, no leading/trailing dot or `..`,
    /// and rejects the reserved names shared with the Rox mail host.
    pub fn parse(value: &str) -> Result<Self, InvalidMailboxHandle> {
        let valid = (3..=32).contains(&value.len())
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
            })
            && !value.starts_with('.')
            && !value.ends_with('.')
            && !value.contains("..")
            && !RESERVED_HANDLES.contains(&value);

        if valid {
            Ok(Self(value.to_owned()))
        } else {
            Err(InvalidMailboxHandle)
        }
    }

    /// Returns the handle as its canonical lowercase string.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consumes the handle and returns its canonical string.
    pub fn into_string(self) -> String {
        self.0
    }

    /// Returns the first-party address owned by this handle.
    pub fn email_address(&self) -> String {
        format!("{}@{ROX_MAIL_DOMAIN}", self.0)
    }
}

impl AsRef<str> for MailboxHandle {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for MailboxHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl TryFrom<String> for MailboxHandle {
    type Error = InvalidMailboxHandle;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}
