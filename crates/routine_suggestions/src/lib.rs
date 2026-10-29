//! AI-picked routine suggestions for each user: one generated set per user,
//! shown in the view sidebars, on the Routines page, and in onboarding's last
//! step. A generation reads the top of the user's inboxes straight from Gmail
//! and Outlook (so it works before the mailbox has synchronized), asks a fast
//! model for routines that fit them, and stores the validated result in
//! `routine_suggestion_set`.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
