# iOS build

This project is packaged for iOS with Capacitor and built in GitHub Actions.
The workflow can now pull the full game source from a Google Drive zip instead of storing the heavy assets directly in GitHub.

## What the workflow does

- `prepare-web-bundle`
  - downloads the source zip from Google Drive
  - extracts the game source
  - overlays the repo-managed iOS build files
  - copies the web runtime into `dist/web`
  - converts `*.ogg` to `*.m4a`
  - converts `*.webm` to `*.mp4`
- `build-ios-simulator`
  - generates the Capacitor iOS project
  - builds an unsigned simulator `.app`
- `build-ios-signed`
  - runs only when Apple signing secrets are present
  - exports an installable `.ipa`

## Required Apple secrets for signed builds

- `IOS_BUILD_CERTIFICATE_BASE64`
- `IOS_P12_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `IOS_KEYCHAIN_PASSWORD`
- `IOS_TEAM_ID`

## Source zip location

Set one of these in repository secrets:

- `GAME_SOURCE_DRIVE_URL`
- `GAME_SOURCE_DRIVE_FILE_ID`

You can also pass one of them manually when running `workflow_dispatch`.

The uploaded zip should contain the game project root, or one top-level folder that contains:

- `data/`
- `tyrano/`
- `index.html`

Optional:

- `IOS_EXPORT_METHOD`
  - defaults to `development`
  - typical values: `development`, `ad-hoc`, `app-store`

## Local commands

```bash
npm install
npm run build:ios:web
```

For a quick local smoke test without ffmpeg:

```bash
node scripts/build-ios-web.mjs --skip-transcode
```

## Google Drive notes

- Make the zip link accessible to anyone with the link.
- If you use a normal share URL, the workflow uses `gdown --fuzzy`.
- If Drive blocks URL parsing, use the file ID instead.
