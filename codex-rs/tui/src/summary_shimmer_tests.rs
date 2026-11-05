use super::*;
use pretty_assertions::assert_eq;

use crate::terminal_palette::with_test_default_colors;
use crate::terminal_probe::DefaultColors;

#[test]
fn short_and_long_labels_sweep_smoothly_in_both_themes() {
    let mut frames = Vec::new();
    for (theme, colors) in [
        (
            "dark",
            DefaultColors {
                fg: (240, 240, 240),
                bg: (16, 16, 16),
            },
        ),
        (
            "light",
            DefaultColors {
                fg: (16, 16, 16),
                bg: (240, 240, 240),
            },
        ),
    ] {
        with_test_default_colors(colors, || {
            for text in ["Working", "Preparing bootstrap diagnostics", "界e\u{301}界"] {
                // Initial delay, the first sweep, the gap, and the next sweep.
                for ms in [0, 850, 1100, 1350, 3600, 5100] {
                    let spans =
                        summary_shimmer(text, Duration::from_millis(ms), MotionMode::Animated);
                    let levels = spans
                        .iter()
                        .map(|span| match span.style.fg {
                            Some(Color::Rgb(r, g, b)) => (r, g, b),
                            color => panic!("expected interpolated RGB, got {color:?}"),
                        })
                        .collect::<Vec<_>>();
                    frames.push(format!("{theme} {text} {ms}ms: {levels:?}"));
                }
            }
        });
    }
    insta::assert_snapshot!(frames.join("\n"));
}

#[test]
fn working_has_overlapping_highlights_without_frame_to_frame_flashes() {
    with_test_default_colors(
        DefaultColors {
            fg: (240, 240, 240),
            bg: (16, 16, 16),
        },
        || {
            let mut previous = Vec::new();
            // Sample two sweeps and the intervening gap at the status row's 32 ms cadence.
            for ms in (0..=5600).step_by(/*step*/ 32) {
                let spans =
                    summary_shimmer("Working", Duration::from_millis(ms), MotionMode::Animated);
                let brightness = spans
                    .iter()
                    .map(|span| match span.style.fg {
                        Some(ratatui::style::Color::Rgb(r, _, _)) => r,
                        color => panic!("expected interpolated RGB, got {color:?}"),
                    })
                    .collect::<Vec<_>>();
                if brightness.iter().any(|value| *value > 230) {
                    assert!(brightness.iter().filter(|value| **value > 210).count() >= 2);
                }
                for (current, previous) in brightness.iter().zip(&previous) {
                    // At this speed the cosine band's maximum change over 32 ms is
                    // 49 * sin(PI * (13 * 0.032) / 6), rounded up.
                    assert!(u8::abs_diff(*current, *previous) <= 12);
                }
                previous = brightness;
            }
            let midpoint = summary_shimmer(
                "Working",
                Duration::from_millis(/*millis*/ 1100),
                MotionMode::Animated,
            );
            let expected = "Working"
                .chars()
                .zip([0.0, 0.25, 0.75, 1.0, 0.75, 0.25, 0.0])
                .map(|(ch, intensity)| {
                    Span::styled(
                        ch.to_string(),
                        Style::default().fg(rgb_color(blend(LIGHT_LILAC, LILAC, intensity))),
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(midpoint, expected);
        },
    );
}

#[test]
fn sweep_preserves_combining_characters_and_emoji_clusters() {
    let text = "e\u{301}👨‍👩‍👧‍👦界";
    let spans = with_test_default_colors(
        DefaultColors {
            fg: (240, 240, 240),
            bg: (16, 16, 16),
        },
        || summary_shimmer(text, Duration::ZERO, MotionMode::Animated),
    );
    assert_eq!(
        spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<Vec<_>>(),
        vec!["e\u{301}", "👨‍👩‍👧‍👦", "界"]
    );
    for span in spans {
        assert!(span.style.bg.is_none());
    }
}

#[test]
fn reduced_motion_keeps_lilac_and_limited_palettes_stay_static() {
    for background in [None, Some((16, 16, 16)), Some((240, 240, 240))] {
        for level in [
            StdoutColorLevel::TrueColor,
            StdoutColorLevel::Ansi256,
            StdoutColorLevel::Ansi16,
            StdoutColorLevel::Unknown,
        ] {
            let before = summary_shimmer_for(
                "Working",
                Duration::ZERO,
                MotionMode::Reduced,
                background,
                level,
            );
            let after = summary_shimmer_for(
                "Working",
                Duration::from_millis(1100),
                MotionMode::Reduced,
                background,
                level,
            );
            assert_eq!(before, after);
            assert_eq!(before.len(), 1);
            assert_eq!(before[0].content, "Working");
            assert_eq!(before[0].style.bg, None);
            assert!(
                !before[0]
                    .style
                    .add_modifier
                    .contains(ratatui::style::Modifier::DIM)
            );
            match level {
                StdoutColorLevel::TrueColor => {
                    let expected = if background.is_some_and(is_light) {
                        (96, 51, 150)
                    } else {
                        LILAC
                    };
                    assert_eq!(before[0].style.fg, Some(rgb_color(expected)));
                }
                StdoutColorLevel::Ansi256 => {
                    assert!(matches!(before[0].style.fg, Some(Color::Indexed(_))))
                }
                StdoutColorLevel::Ansi16 => assert_eq!(before[0].style.fg, Some(Color::Magenta)),
                StdoutColorLevel::Unknown => assert_eq!(before[0].style.fg, Some(Color::Reset)),
            }
            if level != StdoutColorLevel::TrueColor {
                assert_eq!(
                    before,
                    summary_shimmer_for(
                        "Working",
                        Duration::from_millis(1100),
                        MotionMode::Animated,
                        background,
                        level,
                    )
                );
            }
        }
    }
}
