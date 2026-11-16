# LibApp Editor v2.12.7

## Status: architecture complete
- domain, DialogProvider, Wizard/Queue, nav helpers, CandidateCard
- session meta + fingerprint, splash anti-flash, applyAccent
- Results buffer from AppContext, history fp, maxHistory UI

## Flow
Мастер/Файл → Анализ → Патч/Очередь → Compare → APK (+ resign on PC)

## v2.12.7
- Home: removed dead autoBackup local state (openLibapp reads settings itself)
- Presets: clean useAppFile destructure
- .gitignore for Expo

## Earlier
- 2.12.6 Results context buffer, Bookmarks confirm
- 2.12.5 Analyze/Manual/Queue history + session fp fixes
- 2.12.4–3 session meta, accent, white flash

## v2.12.8
- UI style pass: theme.warning / dangerDark / warningSurface
- Hardcoded risk/warn colors → theme tokens
- Presets + PresetEdit: selectable text; radii 12
- Logcat clear → dialog.confirm
- App error screen uses theme colors
- ui.ts: input + warnBox tokens
