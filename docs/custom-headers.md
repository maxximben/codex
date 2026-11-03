# Custom session headers

The `custom-ui` fork supports custom session headers through `[tui.header]` in
`$CODEX_HOME/config.toml` (normally `%USERPROFILE%\.codex\config.toml` on Windows).
Restart Codex after editing the configuration or template file.

## Customize the standard header

```toml
[tui.header]
title = "Maksim Codex"
icon = "λ"
show_version = true
show_directory = true
```

Omitted settings preserve the standard header. Set `icon = ""` to hide the icon.
`show_version` and `show_directory` control the standard layout; a custom template
controls its own layout by including or omitting the corresponding placeholders.

## Replace the header with text or ASCII art

Use a TOML literal multiline string to preserve backslashes and spaces:

```toml
[tui.header]
title = "Maksim Codex"
text = '''
  /\
 /__\  {title} · v{version}
       {directory}
'''
```

Alternatively, save the template as a UTF-8 file and select it:

```toml
[tui.header]
file = "headers/custom.txt"
```

Relative paths resolve against `CODEX_HOME`, so this example reads
`%USERPROFILE%\.codex\headers\custom.txt`. Absolute paths are also supported;
use single quotes for Windows paths, e.g. `file = 'C:\Users\Maksim\header.txt'`.

| Placeholder | Value |
| --- | --- |
| `{title}` | Configured title, or `OpenAI Codex` |
| `{icon}` | Configured icon, or `>_` |
| `{version}` | CLI version without the `v` prefix |
| `{directory}` | Current directory, with the home directory abbreviated as `~` |
| `{model}` | Model display name |
| `{effort}` | Reasoning effort, or an empty string |

Unknown placeholders stay literal. Values inserted into the template are not
expanded again. Templates are plain text; terminal escape sequences are removed.
Each line receives the normal two-column header indentation and is clipped to
the available terminal width, preserving ASCII-art spacing rather than wrapping.

Files are loaded when a header is created, not on every redraw. The file takes
precedence over inline `text`. Unreadable files, invalid UTF-8, and files larger
than 64 KiB log a warning and fall back to `text`, or to the standard header if
no inline template is set. An empty template hides the visual header content.
The permissions notice for YOLO mode remains visible with every layout.

The custom header is used during session loading, in the active session, and
after clearing the screen. The `/status` card keeps its standard title.
