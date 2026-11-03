# User message text

The `custom-ui` fork supports text appearance for submitted user messages.
Add this section to `$CODEX_HOME/config.toml` (normally
`%USERPROFILE%\.codex\config.toml` on Windows):

```toml
[tui.user_message]
color = "#DDBBFF"
bold = true
italic = false
underline = false
dim = false
```

Only sent messages are styled. The editable composer keeps its existing
appearance. Restored conversations, older transcript pages, spoken user
messages, and submitted answers to questions use the same preferences.

`color` accepts `#RRGGBB` or these names:

```text
default, reset, black, red, green, yellow, blue, magenta, cyan, gray,
dark-gray, light-red, light-green, light-yellow, light-blue,
light-magenta, light-cyan, white
```

`default` and `reset` use the terminal's foreground. RGB colors are adapted to
the available terminal palette. The message background remains transparent.

All settings are optional. Omitted modifiers preserve the original formatting;
`true` enables a modifier and `false` explicitly disables it on message text.
Display markers, attachment/link destinations, copied text, and the message
sent to the model retain their existing contents.

Restart Codex after editing the configuration. Remove `[tui.user_message]` and
its settings to restore the default text appearance.
