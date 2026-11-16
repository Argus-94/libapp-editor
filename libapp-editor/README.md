# LibApp Editor

Редактор `libapp.so` (Flutter AOT, ARM64) для Android: анализ, точечный патч, очередь, inject в APK.

## Рекомендуемый поток

1. **Файл** или **Мастер патча** — открыть `libapp.so`
2. **Анализ** — ELF, risk, Code candidates (код в `.text`, не строки `isPro`)
3. **Патч / Очередь** — один offset или пачка сильных кандидатов (score ≥ 55)
4. **Compare** — текущий vs original
5. **APK** — inject, затем **переподпись** на ПК (apksigner / uber-apk-signer)

PRO-скан — только маркеры строк. Auto Unlock — только safe, мало патчей.

## Сборка

```bash
cd libapp-editor
rm -rf node_modules
npm install
npx expo prebuild --platform android   # при необходимости
npx expo run:android
# или EAS / export
```

Expo SDK 52, RN 0.76. Kotlin через `expo-build-properties`.  
`expo-splash-screen` — тёмный splash без белой вспышки при cold start (проверять в production/preview, не в Expo Go).

## Структура

- `src/domain/` — codeSearch, patchQueue, textGuard, patchDiff
- `src/store/AppContext` — buffer, original, dirty, queue, report
- `src/services/fileSession` — persist session meta
- `src/screens/WizardScreen` — пошаговый первый патч
- `src/screens/QueueScreen` — batch + import/export JSON
- `src/components/DialogProvider` — единые диалоги (не system Alert)

## Важно

Патч **строки** Pro в data почти никогда не открывает функции. Нужен offset в **`.text`** (movz/ret). On-device RE — эвристика, не Blutter.

Акцент цвета — после перезапуска приложения (StyleSheet фиксируется при импорте).
