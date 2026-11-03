//! Agent-only skill: calendar events, availability and booking links. How
//! each host confirms `CreateCalendarEvent` is in the host's prompt
//! (`prompt::user_tools`).

use crate::{SystemSkill, Visibility};

/// The calendar skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "calendar",
    name: "Calendar",
    description: "Use when working with calendar events, availability, scheduling a meeting with people, or booking links; not reminders or recurring automations, which are routines.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "ListCalendars",
        "ListCalendarEvents",
        "ReadCalendarEvent",
        "UpdateCalendarEvent",
        "DeleteCalendarEvent",
        "AddSharedCalendarEvent",
        "GetTeamAvailability",
        "ListBookingLinks",
        "CreateBookingLink",
        "EditBookingLink",
        "ListBookings",
        "ChangeBooking",
        "GetBookingInsights",
        "GetBookingRescheduleSlots",
        "ReadBookingSettings",
        "UpdateBookingSettings",
    ],
    sdk_entities: &["calendar", "meetings"],
    instructions: include_str!("calendar.md"),
};
