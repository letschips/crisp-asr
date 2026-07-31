# YS Crisp ASR legacy backup

Created before replacing the YS runtime with Crisp ASR 0.3.1.

- Source vault: `YS`
- Legacy manifest version: `1.0.0`
- Backup time: `2026-07-29 17:54:09` (Asia/Singapore)
- Runtime files: `runtime/`

This backup is private. Its `data.json` contains the legacy plugin's local
connection configuration and must not be included in a shared release.

## SHA-256

- `data.json`: `ad7f2da8d2a11668f6aacc1b7ddb485ae6c9e73faf14b79745ec2fd8dcf1390d`
- `main.js`: `7ffdf4bf9c59f8ac244e15436072ea35051607312eb2402d33a29727f07f567e`
- `manifest.json`: `097baa31b8482e2f4d3bd0b160f80e42bd2541a163d328f18a8e42baeefa8730`
- `styles.css`: `38bf31c85a0810fccc9c1134739c0880d92d232c2ce613d4c7809832e57361c2`

## Restore

Disable Crisp ASR in YS, copy the four files under `runtime/` back to
`YS/.obsidian/plugins/crisp-asr/`, then enable or reload the plugin.
