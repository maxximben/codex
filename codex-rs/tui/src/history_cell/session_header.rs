//! User-defined session header fields and UTF-8 templates, loaded before rendering.

use super::*;
use codex_config::types::TuiHeader;
use std::io::Read;

const MAX_HEADER_BYTES: u64 = 64 * 1024;

impl SessionHeaderHistoryCell {
    pub(crate) fn with_header(mut self, header: &TuiHeader, codex_home: &Path) -> Self {
        self.header = header.clone();
        self.header_text = header.file.as_ref().and_then(|file| {
            let path = codex_home.join(file);
            let read = || -> std::io::Result<String> {
                let mut text = String::new();
                std::fs::File::open(&path)?
                    .take(MAX_HEADER_BYTES + 1)
                    .read_to_string(&mut text)?;
                if text.len() as u64 > MAX_HEADER_BYTES {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "header template exceeds 64 KiB",
                    ));
                }
                Ok(text)
            };
            match read() {
                Ok(text) => Some(text),
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "Could not load custom session header");
                    None
                }
            }
        });
        if self.header_text.is_none() {
            self.header_text = header.text.clone();
        }
        self
    }

    pub(super) fn header_title(&self) -> String {
        single_line(self.header.title.as_deref().unwrap_or("OpenAI Codex"))
    }

    pub(super) fn header_icon(&self) -> String {
        single_line(self.header.icon.as_deref().unwrap_or(">_"))
    }

    pub(super) fn title_spans(&self) -> Vec<Span<'static>> {
        let icon = self.header_icon();
        let mut spans = Vec::new();
        if !icon.is_empty() {
            spans.push(format!("{icon} ").fg(accent_color()));
        }
        spans.push(self.header_title().bold());
        if self.header.show_version {
            spans.push(format!(" (v{})", self.version).dim());
        }
        spans
    }

    pub(super) fn custom_header_lines(&self) -> Option<Vec<Line<'static>>> {
        let text = self.header_text.as_deref()?.trim_start_matches('\u{feff}');
        let title = self.header_title();
        let icon = self.header_icon();
        let directory = self.format_directory(None);
        let values = [
            ("title", title.as_str()),
            ("icon", icon.as_str()),
            ("version", self.version),
            ("directory", directory.as_str()),
            ("model", self.model.as_str()),
            ("effort", self.reasoning_label().unwrap_or_default()),
        ];
        // Expand only the original template: braces inside substituted titles and paths are literal.
        let mut rendered = String::new();
        let mut remaining = text;
        while let Some((prefix, after_open)) = remaining.split_once('{') {
            rendered.push_str(prefix);
            let Some((key, tail)) = after_open.split_once('}') else {
                rendered.push('{');
                remaining = after_open;
                break;
            };
            if let Some((_, value)) = values.iter().find(|(name, _)| *name == key) {
                rendered.push_str(value);
            } else {
                rendered.push('{');
                rendered.push_str(key);
                rendered.push('}');
            }
            remaining = tail;
        }
        rendered.push_str(remaining);
        let rendered = crate::history_cell::sanitize_user_text(rendered.into());
        Some(
            rendered
                .lines()
                .map(|line| Line::from(line.replace('\t', "    ")))
                .collect(),
        )
    }
}

fn single_line(text: &str) -> String {
    crate::history_cell::sanitize_user_text(text.into()).replace(['\n', '\t'], " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn cell(header: &TuiHeader, home: &Path) -> SessionHeaderHistoryCell {
        SessionHeaderHistoryCell::new(
            "test-model".into(),
            Some(ReasoningEffortConfig::High),
            home.join("project"),
            "1.2.3",
        )
        .with_header(header, home)
    }

    #[test]
    fn custom_fields_and_visibility_apply_to_rich_and_raw_headers() {
        let home = tempfile::tempdir().unwrap();
        let cell = cell(
            &TuiHeader {
                title: Some("My CLI".into()),
                icon: Some("λ".into()),
                show_version: false,
                show_directory: false,
                ..Default::default()
            },
            home.path(),
        );
        assert_eq!(
            cell.display_lines(80)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            ["", "  λ My CLI"]
        );
        assert_eq!(cell.raw_lines()[0].to_string(), "My CLI");
        assert_eq!(cell.raw_lines().len(), 2);
    }

    #[test]
    fn templates_expand_once_and_keep_yolo_notice_and_narrow_widths() {
        let home = tempfile::tempdir().unwrap();
        let cell = cell(
            &TuiHeader {
                title: Some("literal {version}".into()),
                text: Some("{icon} {title}\n{version} {model} {effort}\n{unknown}".into()),
                ..Default::default()
            },
            home.path(),
        )
        .with_yolo_mode(true);
        let raw = cell.raw_lines();
        assert_eq!(raw[0].to_string(), ">_ literal {version}");
        assert_eq!(raw[1].to_string(), "1.2.3 test-model high");
        assert_eq!(raw[2].to_string(), "{unknown}");
        assert_eq!(raw[3].to_string(), "permissions: YOLO mode");
        for width in [0, 1, 8, 24] {
            assert!(
                cell.display_lines(width)
                    .iter()
                    .all(|line| line.width() <= usize::from(width))
            );
        }
    }

    #[test]
    fn relative_file_overrides_inline_text_and_is_cached() {
        let home = tempfile::tempdir().unwrap();
        let file = home.path().join("header.txt");
        std::fs::write(&file, "\u{feff}  /\\\r\n /__\\ {title}\r\n{directory}").unwrap();
        let cell = cell(
            &TuiHeader {
                text: Some("fallback".into()),
                file: Some("header.txt".into()),
                ..Default::default()
            },
            home.path(),
        );
        std::fs::write(&file, "changed").unwrap();
        let raw = cell.raw_lines();
        assert_eq!(raw[0].to_string(), "  /\\");
        assert_eq!(raw[1].to_string(), " /__\\ OpenAI Codex");
        assert_eq!(raw[2].to_string(), cell.format_directory(None));
    }

    #[test]
    fn invalid_file_falls_back_to_inline_then_standard_header() {
        let home = tempfile::tempdir().unwrap();
        let mut header = TuiHeader {
            file: Some("missing.txt".into()),
            text: Some("fallback".into()),
            ..Default::default()
        };
        assert_eq!(
            cell(&header, home.path()).raw_lines()[0].to_string(),
            "fallback"
        );
        header.text = None;
        assert_eq!(
            cell(&header, home.path()).raw_lines()[0].to_string(),
            "OpenAI Codex (v1.2.3)"
        );
        std::fs::write(
            home.path().join("missing.txt"),
            vec![b'x'; MAX_HEADER_BYTES as usize + 1],
        )
        .unwrap();
        assert!(cell(&header, home.path()).header_text.is_none());
    }
}
