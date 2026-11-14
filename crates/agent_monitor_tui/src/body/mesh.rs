//! The BODY pane drawn by the mesh man: every tool call fires a pulse along
//! the agent's nerve, results run back, errors flash red, and his heart
//! follows tokens per minute.

use std::time::Duration;

use mesh_man::{Body, ColorDepth, PulseKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::Widget as _;

use agent_monitor::domain::model::{TapeEvent, TapeKind, Totals};

use crate::body::BodyPane;

/// Tokens per minute at which the heart reaches its peak rate.
const PEAK_TOKENS_PER_MIN: f32 = 5_000_000.0;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Colorterm;
    }
}

/// The mesh man as the BODY pane.
#[derive(Clone, Debug, Default)]
pub struct MeshBody {
    body: Body,
}

impl MeshBody {
    /// The mesh man in the colours this terminal shows: truecolor when
    /// `COLORTERM` says so, else the 256 indexed colours.
    pub fn for_terminal() -> Self {
        let colorterm = environment::Colorterm::new();
        let depth = ColorDepth::from_colorterm(colorterm.as_ref().and_then(|value| value.value()));
        let mut body = Body::new();
        body.set_color_depth(depth);
        Self { body }
    }
}

impl BodyPane for MeshBody {
    fn title(&self) -> &str {
        "MESH MAN"
    }

    fn event(&mut self, event: &TapeEvent) {
        let kind = match event.kind {
            TapeKind::ToolStart => PulseKind::ToolStart,
            TapeKind::ToolEnd => PulseKind::ToolResult,
            TapeKind::ToolError | TapeKind::Failure | TapeKind::PrCiFailed => PulseKind::Error,
            TapeKind::TurnEnd => PulseKind::TurnEnd,
            TapeKind::Spawned
            | TapeKind::PrOpened
            | TapeKind::PrCiPassed
            | TapeKind::PrMerged
            | TapeKind::PrClosed
            | TapeKind::Status
            | TapeKind::TurnStart
            | TapeKind::Finished
            | TapeKind::Removed => return,
        };
        self.body.fire(event.agent.as_str(), kind);
    }

    fn totals(&mut self, totals: &Totals) {
        let tokens = totals.tokens_per_min.last().copied().unwrap_or(0);
        // A log scale: a quiet fleet still has a pulse, a busy one races.
        // Display only; per-minute token counts are far below f32's range.
        let load = (tokens as f32).ln_1p() / PEAK_TOKENS_PER_MIN.ln_1p();
        self.body.set_load(load.clamp(0.0, 1.0));
    }

    fn tick(&mut self, elapsed: Duration) {
        self.body.tick(elapsed);
    }

    fn animating(&self) -> bool {
        // He turns continuously.
        true
    }

    fn render(&self, area: Rect, buffer: &mut Buffer) {
        (&self.body).render(area, buffer);
    }
}
