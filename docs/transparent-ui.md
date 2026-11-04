# Transparent terminal UI

The `custom-ui` fork uses the terminal's default background for the composer,
submitted messages, menus, cards and side panes. Terminal opacity and background
images remain controlled by your terminal application.

Menu panels are separated from the conversation by thin horizontal rules above
and below their content. Keyboard hints remain below the lower rule. Very short
panels prioritize readable controls over decorative rules.

Active tabs and the **Back to bottom** control share a compact lavender fill with
bold dark text. Inactive tabs preserve the transparent background. Hovering over
the return control adds an underline without changing its colors. Terminals with
limited color support use reverse video for the active label.

Composer stars blend their foreground against the terminal palette while retaining
the transparent background.

The same treatment applies to configuration groups, model and effort pickers,
approvals, questions and other menus that use the shared picker components.
