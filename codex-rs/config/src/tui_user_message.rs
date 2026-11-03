//! Text appearance for submitted user messages; independent of the editable composer.

use schemars::JsonSchema;
use schemars::r#gen::SchemaGenerator;
use schemars::schema::Schema;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;

const COLORS: &[&str] = &[
    "default",
    "reset",
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "gray",
    "dark-gray",
    "light-red",
    "light-green",
    "light-yellow",
    "light-blue",
    "light-magenta",
    "light-cyan",
    "white",
];

/// Text style for sent user messages, including restored conversation history.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default, JsonSchema)]
#[serde(default)]
#[schemars(deny_unknown_fields)]
pub struct TuiUserMessage {
    /// Foreground as #RRGGBB, a named ANSI color, or default. The background stays transparent.
    #[serde(deserialize_with = "deserialize_color")]
    #[schemars(schema_with = "color_schema")]
    pub color: Option<String>,
    /// Unset values preserve the existing formatting; false explicitly disables the modifier.
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub dim: Option<bool>,
}

fn deserialize_color<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    let color = Option::<String>::deserialize(deserializer)?;
    if let Some(value) = &color {
        let hex = value
            .strip_prefix('#')
            .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()));
        if !hex && !COLORS.contains(&value.as_str()) {
            return Err(serde::de::Error::custom(
                "tui.user_message.color must be #RRGGBB, a named ANSI color (e.g. cyan or light-magenta), or default",
            ));
        }
    }
    Ok(color)
}

fn color_schema(generator: &mut SchemaGenerator) -> Schema {
    let mut schema = Option::<String>::json_schema(generator).into_object();
    schema.string().pattern = Some(format!("^(#[0-9a-fA-F]{{6}}|{})$", COLORS.join("|")));
    schema.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_message_colors_and_optional_modifiers_are_validated() {
        assert_eq!(
            toml::from_str::<TuiUserMessage>("").unwrap(),
            TuiUserMessage::default()
        );
        for value in ["#DDBBFF", "cyan", "light-magenta", "default"] {
            let config: TuiUserMessage =
                toml::from_str(&format!("color = '{value}'\nbold = false\nitalic = true")).unwrap();
            assert_eq!(config.color.as_deref(), Some(value));
            assert_eq!(config.bold, Some(false));
            assert_eq!(config.italic, Some(true));
            assert_eq!(config.underline, None);
        }
        for value in ["#123", "#GG1234", "purple-ish", "rgb(1,2,3)", "\u{1b}[31m"] {
            assert!(toml::from_str::<TuiUserMessage>(&format!("color = '{value}'")).is_err());
        }
    }
}
