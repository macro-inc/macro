// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! Various structs and other types used by whatsmeow.
//!
//! Not ported: `botmap.go`, `business.go`, `call.go`, `newsletter.go`,
//! `sticker.go` and `richresponse/` (features the port skips).

/// Go's string-typed constants (`type ReceiptType string`) as an enum with the
/// known values plus `Other` for whatever else the server sends, so unknown
/// values survive a round trip like they do in Go.
macro_rules! string_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident {
            $(
                $(#[$variant_meta:meta])*
                $variant:ident = $value:literal,
            )*
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub enum $name {
            $(
                $(#[$variant_meta])*
                $variant,
            )*
            /// A value this port doesn't know.
            Other(String),
        }

        impl $name {
            /// The wire value.
            pub fn as_str(&self) -> &str {
                match self {
                    $($name::$variant => $value,)*
                    $name::Other(value) => value,
                }
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                match value {
                    $($value => $name::$variant,)*
                    other => $name::Other(other.to_owned()),
                }
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                $name::from(value.as_str())
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

pub mod events;
mod group;
mod jid;
mod message;
mod passkey;
mod presence;
mod user;

pub use group::*;
pub use jid::*;
pub use message::*;
pub use passkey::*;
pub use presence::*;
pub use user::*;
