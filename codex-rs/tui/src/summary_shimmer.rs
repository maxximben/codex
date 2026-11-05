//! Smooth, whole-grapheme status shimmer with the desktop's cadenced sweep.
//!
//! The moving band blends a lilac base into a lighter lilac highlight. Both colors
//! stay on the terminal's transparent background. Light themes use deeper shades
//! to keep the highlight legible. The wave spans at least six terminal columns
//! so short labels do not flash one letter at a time.
//! New headers wait 600 ms, then sweep for one second every four seconds.
//! Reduced motion and limited palettes use a static label without a stepped animation.

use std::time::Duration;

use ratatui::style::Color;
use ratatui::style::Style;
use ratatui::text::Span;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use crate::color::blend;
use crate::color::is_light;
use crate::motion::MotionMode;
use crate::terminal_palette::StdoutColorLevel;
use crate::terminal_palette::best_color_for_level;
use crate::terminal_palette::default_bg;
use crate::terminal_palette::effective_stdout_color_level;
use crate::terminal_palette::rgb_color;

// Match the desktop app's thinking and reasoning header timings.
const START_DELAY: Duration = Duration::from_millis(/*millis*/ 600);
const SWEEP_SECONDS: f64 = 1.0;
const INTERVAL_SECONDS: f64 = 4.0;
const LILAC: (u8, u8, u8) = (190, 153, 242);
const LIGHT_LILAC: (u8, u8, u8) = (239, 222, 255);

pub(crate) fn summary_shimmer(
    text: &str,
    elapsed: Duration,
    motion: MotionMode,
) -> Vec<Span<'static>> {
    summary_shimmer_for(
        text,
        elapsed,
        motion,
        default_bg(),
        effective_stdout_color_level(),
    )
}

fn summary_shimmer_for(
    text: &str,
    elapsed: Duration,
    motion: MotionMode,
    background: Option<(u8, u8, u8)>,
    color_level: StdoutColorLevel,
) -> Vec<Span<'static>> {
    let (base, highlight) = if background.is_some_and(is_light) {
        ((96, 51, 150), (132, 80, 181))
    } else {
        (LILAC, LIGHT_LILAC)
    };
    if motion == MotionMode::Reduced || color_level != StdoutColorLevel::TrueColor {
        let color = match color_level {
            StdoutColorLevel::Ansi16 => Color::Magenta,
            _ => best_color_for_level(base, color_level),
        };
        return vec![Span::styled(text.to_owned(), Style::default().fg(color))];
    }
    let width = text.width() as f64;
    let half_width = (width * 0.1).max(/*other*/ 3.0);
    let sweep =
        (elapsed.saturating_sub(START_DELAY).as_secs_f64() % INTERVAL_SECONDS).min(SWEEP_SECONDS);
    let position = sweep / SWEEP_SECONDS * (width + 2.0 * half_width) - half_width;
    let mut column = 0.0;
    text.graphemes(/*is_extended*/ true)
        .map(|grapheme| {
            let glyph_width = grapheme.width() as f64;
            let center = column + glyph_width / 2.0;
            column += glyph_width;
            let distance = ((center - position).abs() / half_width).min(/*other*/ 1.0);
            let intensity = 0.5 * (1.0 + (std::f64::consts::PI * distance).cos());
            let style = Style::default().fg(rgb_color(blend(highlight, base, intensity as f32)));
            Span::styled(grapheme.to_owned(), style)
        })
        .collect()
}

#[cfg(test)]
#[path = "summary_shimmer_tests.rs"]
mod tests;
