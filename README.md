# Usage Meter Pills

A pill-style band above the Claude Code prompt (desktop app) that shows your plan usage at a glance.

- **5-hour and weekly limits** with a bar, a pace marker (how far through the window you are) and the reset time
- **Context window** fill, with a warning near full
- **Git branch**, with a dot when there are uncommitted changes
- Optional **session tokens** and **cost**
- Alert colors when you burn through a limit faster than time passes
- Compact layout, light-theme text, rounded or rectangular pills, reset as countdown or clock time
- Per-limit colors, including a custom hex color

## Install

From the marketplace in this repo:

```text
/plugin marketplace add wellbrained/usage-meter-mod
/plugin install usage-meter-pills@usage-meter-mod
```n
Or load a local copy for one run:

```bash
claude --plugin-dir "D:\Github\usage-meter-pills"
```

Or put the folder in `~/.claude/mods/` to load it every time. Disable any older usage-meter plugin so you don't get two bands.

## Options

Type `/usage-meter-options` (or press the gear next to the band) to open the settings pane. Each option has a live sample on the right.
Color changes can be saved or cancelled; every other option is kept immediately.

## Notes

- The pills are drawn as an SVG on the desktop app; the terminal gets a plain text line instead.
- The band's dark frame belongs to the app and can't be styled from a plugin.
- Free-reset information isn't exposed to plugins, so it isn't shown.
