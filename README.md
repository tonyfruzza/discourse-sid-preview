# discourse-sid-preview

Inline SID file preview player for Discourse — lets users play Commodore 64 `.sid` music files directly in forum posts.

## Overview

When a user uploads a `.sid` file to a post, this plugin detects the download link and renders a compact inline player below it. The original download link remains intact.

![docs/screenshot.png](docs/screenshot.png)

## Engine

Leverages **jsSID** by Hermit (Mihaly Horvath) — a pure JavaScript SID emulator (~14 KB) licensed under WTFPL.

- 6502 CPU emulation (cycle-based at audio sample rate)
- MOS 6581/8580 SID chip emulation with filter
- PSID/RSID format support
- 2SID/3SID multi-chip support
- ADSR delay-bug simulation
- No digi playback (by design — lightweight engine)

Source: https://github.com/og2t/jsSID

## Features

- **Play / Pause / Stop / Restart** controls
- Auto-stop at configurable time limit (default 60 seconds)
- SID metadata display (title, author)
- Subtune selector for multi-tune SID files
- Progress bar
- Retro C64-inspired visual theme
- Mobile responsive
- Non-intrusive — only activates on posts containing `.sid` links

## Plugin Settings

| Setting | Default | Description |
|---|---|---|
| `sid_preview_enabled` | `true` | Master toggle |
| `sid_preview_max_seconds` | `60` | Auto-stop limit |
| `sid_preview_default_model` | `6581` | Default SID chip model |

**Important**: Add `sid` to your Discourse **authorized extensions** site setting so uploads are accepted.

## Installation

### Option A: Git clone during init (recommended for your k8s setup)

Add to your Discourse init script:

```bash
cd /var/www/discourse/plugins
git clone https://github.com/tonyfruzza/discourse-sid-preview.git
```

## Credits

- **jsSID** by Hermit (Mihaly Horvath) — WTFPL license
- **DeepSID** by Chordian — reference architecture
- **libsidplayfp** project — upstream SID emulation library
