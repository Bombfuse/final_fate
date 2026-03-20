# Assets

This directory holds runtime assets loaded by the Bevy application.

## Expected files

### `icon.png`
The app attempts to load an image at:

- `final_fate/board_app/assets/icon.png`

It is used as a demo sprite to prove image rendering works. If the file is missing, Bevy will log a warning, but the app should still run.

**Suggested icon:**
- Format: PNG
- Size: 64x64 or 128x128
- Transparent background recommended

## Notes
- Bevy’s default asset loader reads from the crate’s `assets/` directory at runtime.
- Keep filenames lowercase and stable, since they are referenced by string paths in code.