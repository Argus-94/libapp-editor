# LibApp Editor v2.9.5

## v2.9.5 — on-device RE (not Blutter/r2/Ghidra)
- New module `src/utils/onDeviceRe.ts`
- ADRP+ADD xref from PRO strings → movz x0/w0 #0 + ret in .text
- Analyze screen: section **Code candidates** with score, patch HEX, Manual Patch
- Full Blutter / radare2 / Ghidra remain desktop-only (impossible in Expo RN)

## Prior
- 2.9.4 audit, KEYS, ResultsScreen guards, gesture-handler, Kotlin 1.9.25
