use std::fmt;

#[cfg(test)]
mod test;

/// A color a person chose for one of their calendars, stored as lowercase
/// `#rrggbb` in `calendar_color_preferences` and shown instead of the
/// provider's color. It is never written back to the provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarColor(String);

/// The value is not a `#rrggbb` hex color.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("a calendar color must be a #rrggbb hex color")]
pub struct InvalidCalendarColor;

impl CalendarColor {
    /// Accept `#rrggbb` in either case and keep it lowercase.
    pub fn parse(value: &str) -> Result<Self, InvalidCalendarColor> {
        let digits = value.strip_prefix('#').ok_or(InvalidCalendarColor)?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(InvalidCalendarColor);
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    /// The color as lowercase `#rrggbb`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CalendarColor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What setting or clearing a person's calendar color did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarColorWrite {
    /// The calendar is not one the person can see.
    NotVisible,
    /// The stored color already matched.
    Unchanged,
    /// The color changed on a calendar synced through `email_link_id`.
    Changed {
        /// The inbox holding the calendar, whose viewers refetch it.
        email_link_id: uuid::Uuid,
    },
}
