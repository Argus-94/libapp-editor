import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation, Platform, UIManager,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useDialog } from "../components/DialogProvider";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const RESIGN_SCRIPT = `#!/bin/bash
APK="$1"
if [ -z "$APK" ]; then
  echo "Usage: resign.sh app_patched.apk"
  exit 1
fi
KEYSTORE=debug.keystore
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkey -v -keystore debug.keystore -storepass android -alias androiddebugkey \\
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \\
    -dname "CN=Debug,O=Android,C=US"
fi
zipalign -f -p 4 "$APK" aligned.apk
apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android aligned.apk
apksigner verify aligned.apk
echo "OK: aligned.apk"
`;

type Section = { id: string; title: string; body: string };

const SECTIONS: Section[] = [
  {
    id: "what",
    title: "1. Что это за программа простыми словами",
    body:
      "LibApp Editor — помощник для файлов Flutter-приложений.\n\n" +
      "Многие Android-приложения на Flutter хранят логику в файле libapp.so " +
      "(внутри APK, папка lib/arm64-v8a/).\n\n" +
      "Программа умеет:\n" +
      "• открыть этот файл и посмотреть, что внутри;\n" +
      "• найти упоминания Pro / подписки / покупок;\n" +
      "• оценить, опасно ли «авторазблокировать»;\n" +
      "• вручную поменять несколько байт по адресу;\n" +
      "• подставить файл обратно в APK.\n\n" +
      "Важно: это НЕ волшебная кнопка «сделать Pro навсегда». " +
      "На части приложений Pro проверяется через Google Play, и правка so ничего не даст " +
      "или сломает запуск. Сначала всегда анализ, потом осторожный патч.",
  },
  {
    id: "words",
    title: "2. Словарь (чтобы не путаться)",
    body:
      "• APK — установочный файл приложения (как .exe, но для Android).\n" +
      "• libapp.so — «мозги» Flutter-приложения в машинном коде.\n" +
      "• Offset / адрес — номер байта в файле, например 0x0012AB00.\n" +
      "• HEX — запись байт шестнадцатерично: 00 00 80 D2.\n" +
      "• movz x0, #0 / #1 — типичная команда «вернуть false / true» на ARM64.\n" +
      "• ret — «конец функции, вернуть результат».\n" +
      "• Analyze — только осмотр, файл НЕ меняется.\n" +
      "• Manual Patch — правка одного места по адресу.\n" +
      "• Auto Unlock — автоматическая правка многих мест (ОПАСНО).\n" +
      "• Fingerprint (fp) — короткий отпечаток файла, чтобы понять, изменился ли он.\n" +
      "• Подпись APK — защита Android: после правки APK нужно подписать заново.",
  },
  {
    id: "prep",
    title: "3. Подготовка (сделай до всего)",
    body:
      "1) Поставь приложение, с которым будешь работать, с официального источника (чтобы был «чистый» оригинал).\n\n" +
      "2) Сделай копию APK:\n" +
      "   • через «поделиться APK» / backup / MT Manager / SAI и т.п.\n" +
      "   • сохрани оригинал в отдельную папку — не перезаписывай его.\n\n" +
      "3) На устройстве разреши установку из неизвестных источников (для тестовой подписи).\n\n" +
      "4) В LibApp Editor в настройках лучше оставить «Автобэкап» включённым — " +
      "при открытии .so создастся копия в кэше.\n\n" +
      "5) Если APK очень большой (больше ~55 МБ), телефон может не вытянуть сборку целиком. " +
      "Тогда на любом ПК: переименуй .apk → .zip → достань lib/arm64-v8a/libapp.so → " +
      "работай только с .so в этом редакторе.",
  },
  {
    id: "open-so",
    title: "4. Шаг A — открыть libapp.so",
    body:
      "Вариант 1 — уже есть отдельный .so:\n" +
      "1. Вкладка «Поиск».\n" +
      "2. «Выбрать libapp.so».\n" +
      "3. Дождись загрузки. Внизу увидишь размер и fp (отпечаток).\n\n" +
      "Вариант 2 — только APK:\n" +
      "1. Вкладка «APK».\n" +
      "2. «Выбрать APK».\n" +
      "3. Если нашли libapp.so — нажми «Analyze» или «Платные функции».\n" +
      "   Файл сам подставится в редактор.\n\n" +
      "Если ошибка «слишком большой» — извлеки .so на ПК (см. п.3) и открой .so вручную.",
  },
  {
    id: "analyze",
    title: "5. Шаг B — Analyze Report (обязательно!)",
    body:
      "Это главный безопасный шаг. Файл не меняется.\n\n" +
      "1. На «Поиск» нажми большую кнопку «Analyze Report (дампер)».\n" +
      "2. Жми «Сканировать».\n" +
      "3. Смотри блок RISK:\n" +
      "   • LOW / MEDIUM — автопатч ещё можно обсуждать с лимитом.\n" +
      "   • HIGH / CRITICAL — массовый Auto Unlock, скорее всего, уронит приложение.\n\n" +
      "4. Смотри Bool patterns:\n" +
      "   • imm_ret — «безопасные» короткие кандидаты;\n" +
      "   • near_ret — больше совпадений, выше шанс краша.\n\n" +
      "5. Блок PRO / getters — строки вроде get:ownsPro, isPro.\n" +
      "   • Короткое нажатие — disasm рядом со строкой.\n" +
      "   • Долгое нажатие — открыть Manual Patch на этот offset.\n\n" +
      "6. «Export MD» / «Export JSON» — сохрани отчёт себе (можно скинуть в чат).\n\n" +
      "Запомни: наличие строки isPro НЕ значит, что рядом лежит кнопка «включить Pro». " +
      "У Flutter имя часто в data, а код — в другом месте.",
  },
  {
    id: "premium",
    title: "6. Шаг C — Платные функции (подсветка)",
    body:
      "1. Кнопка «Платные функции (подсветка)» на главной.\n" +
      "2. «Сканировать и подсветить».\n" +
      "3. Цвета:\n" +
      "   • красный / critical — сильные маркеры (ownsPro, get:ownsPro…);\n" +
      "   • оранжевый / high — важные флаги;\n" +
      "   • жёлтый и ниже — слабее, часто просто слова в ресурсах.\n\n" +
      "4. Фильтры сверху: GET, PRO, SUB, IAP, ADS…\n\n" +
      "5. На карточке:\n" +
      "   • Manual — открыть точечный патч с этим адресом;\n" +
      "   • Copy — поделиться/скопировать offset;\n" +
      "   • TRUE/FALSE near — попытка переключить bool РЯДОМ со строкой.\n\n" +
      "Если написано «код геттера скорее НЕ рядом» — не жми TRUE пачками. " +
      "Иди в Manual или оставь как есть.",
  },
  {
    id: "manual",
    title: "7. Шаг D — Manual Patch (правильно и аккуратно)",
    body:
      "Нужен, когда знаешь offset (из Analyze, платных функций или R2Droid).\n\n" +
      "1. Открой «Manual Patch (offset)».\n" +
      "2. Вставь offset: 0x00123456 или просто число.\n" +
      "3. «Показать disasm» — увидишь команды вокруг.\n" +
      "4. Если на адресе как раз:\n" +
      "      00 00 80 D2  (movz x0, #0 = false)\n" +
      "   можно «Toggle movz bool» → станет\n" +
      "      20 00 80 D2  ( #1 = true).\n\n" +
      "5. Если нужно произвольное — впиши hex в поле Write и «Write bytes».\n" +
      "6. «Сохранить / Share .so» — выгрузи файл.\n\n" +
      "Правило новичка: за один заход меняй МАЛО мест (1–3). " +
      "После каждого серьёзного изменения — проверка запуска приложения.",
  },
  {
    id: "auto",
    title: "8. Auto Unlock — когда можно и когда нельзя",
    body:
      "Автоматически ищет шаблон: «вернуть 0 и сразу ret» и меняет на «вернуть 1».\n\n" +
      "По умолчанию:\n" +
      "• режим SAFE включён;\n" +
      "• лимит патчей маленький (около 5).\n\n" +
      "НЕ нажимай Auto Unlock «на удачу», если:\n" +
      "• Risk HIGH/CRITICAL;\n" +
      "• near_ret десятки/сотни;\n" +
      "• ты уже видел вылет после похожего патча (как на Dron Alerts).\n\n" +
      "Если очень хочется попробовать:\n" +
      "1) Есть backup оригинального .so / APK.\n" +
      "2) SAFE = вкл.\n" +
      "3) Макс. патчей = 1…3.\n" +
      "4) Собрал APK → установил → если НЕ запустилось — откат к backup.\n\n" +
      "Auto Unlock — эксперимент, не обещание Pro.",
  },
  {
    id: "apk",
    title: "9. Шаг E — собрать APK обратно",
    body:
      "1. Вкладка APK → выбери тот же исходный APK (или уже открытый).\n" +
      "2. Убедись, что нужный abi (обычно arm64-v8a) пропатчен:\n" +
      "   • правки через Analyze/Manual попадают в общий файл;\n" +
      "   • при сборке редактор старается подтянуть текущий буфер.\n" +
      "3. Нажми сборку / «собрать APK».\n" +
      "4. В отчёте смотри:\n" +
      "   • size до/после;\n" +
      "   • fp до/после (отпечаток должен измениться, если so реально заменили);\n" +
      "   • сколько файлов подписи META-INF снято.\n\n" +
      "5. Сохрани выданный *_patched.apk.\n\n" +
      "Без новой подписи Android часто НЕ установит пакет.",
  },
  {
    id: "sign",
    title: "10. Шаг F — подпись и установка",
    body:
      "На телефоне (упрощённо):\n" +
      "• приложения вроде APK Editor / MT Manager иногда умеют «подписать»;\n" +
      "• либо другие подписчики APK — на свой страх и риск.\n\n" +
      "На ПК (надёжнее):\n" +
      "• uber-apk-signer -a app_patched.apk\n" +
      "• или zipalign + apksigner (скрипт resign.sh — кнопка ниже).\n\n" +
      "Установка:\n" +
      "1. Удали старую версию приложения (если подпись другая — иначе конфликт).\n" +
      "2. Установи подписанный APK.\n" +
      "3. При первом запуске смотри: открылось ли вообще.\n" +
      "4. Только потом проверяй Pro / рекламу / paywall.\n\n" +
      "Если вылет сразу при старте — почти наверняка виноват патч so, не «забыл галочку». " +
      "Верни чистый so и ставь заново.",
  },
  {
    id: "check",
    title: "11. Как понять, что сработало",
    body:
      "Успех:\n" +
      "• приложение запускается;\n" +
      "• пропал paywall / открылся чат / нет рекламы — в зависимости от приложения;\n" +
      "• fp у so отличается от оригинала (значит подмена на месте).\n\n" +
      "Неуспех, но приложение живое:\n" +
      "• Pro по-прежнему закрыт — проверка, скорее всего, через Play Billing / сервер.\n" +
      "  Правка so эвристикой тут бессильна; нужен точечный RE или другой подход.\n\n" +
      "Провал:\n" +
      "• мгновенный вылет — откат, Analyze, меньше патчей / только Manual.\n\n" +
      "Сравни два so во вкладке «Сравнить .so»: увидишь, сколько байт реально изменилось.",
  },
  {
    id: "hex",
    title: "12. Шпаргалка HEX (ARM64 / Flutter)",
    body:
      "False → True (частый Flutter):\n" +
      "  00 00 80 D2   →   20 00 80 D2\n" +
      "  (movz x0,#0)      (movz x0,#1)\n\n" +
      "То же для w0:\n" +
      "  00 00 80 52   →   20 00 80 52\n\n" +
      "Конец функции:\n" +
      "  C0 03 5F D6   = ret\n\n" +
      "Не меняй случайные 00 00 80 D2 по всему файлу — их сотни, приложение развалится.",
  },
  {
    id: "errors",
    title: "13. Частые ошибки новичков",
    body:
      "1. Сразу Auto Unlock на весь файл → вылет.\n" +
      "2. Путают строку «isPro» с кодом проверки Pro.\n" +
      "3. Забыли переподписать APK → «приложение не установлено».\n" +
      "4. Поставили поверх старой версии с другой подписью → конфликт, нужна удаление.\n" +
      "5. Патчили armeabi-v7a, а телефон берёт arm64 (или наоборот).\n" +
      "6. Нет backup — нечего откатывать.\n" +
      "7. Ждут Pro, хотя логика только в Google Play / на сервере.",
  },
  {
    id: "flow",
    title: "14. Идеальный маршрут «для чайника» (кратко)",
    body:
      "1. Копия оригинального APK.\n" +
      "2. Открыть so (или APK → Analyze).\n" +
      "3. Analyze Report → прочитать RISK.\n" +
      "4. Платные функции → посмотреть critical/high.\n" +
      "5. При необходимости 1–2 ручных патча (Manual).\n" +
      "6. Собрать APK → смотреть fp.\n" +
      "7. Подписать → удалить старое → установить.\n" +
      "8. Запуск OK? → смотреть Pro. Вылет? → backup и меньше правок.\n\n" +
      "Не перескакивай сразу к шагу Auto Unlock.",
  },
];

function Accordion({ section, open, onToggle }: { section: Section; open: boolean; onToggle: () => void }) {
  return (
    <View style={styles.acc}>
      <TouchableOpacity
        style={styles.accHead}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          onToggle();
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.accTitle} selectable>{section.title}</Text>
        <Text style={styles.accChevron} selectable>{open ? "▼" : "▶"}</Text>
      </TouchableOpacity>
      {open && <Text style={styles.accBody} selectable>{section.body}</Text>}
    </View>
  );
}

export default function HelpScreen() {
  const dialog = useDialog();
  const [openId, setOpenId] = useState<string | null>("what");

  const shareScript = async () => {
    const uri = (FileSystem.cacheDirectory || "") + "resign.sh";
    await FileSystem.writeAsStringAsync(uri, RESIGN_SCRIPT, { encoding: "utf8" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { dialogTitle: "resign.sh" });
    } else {
      dialog.alert("Скрипт", uri);
    }
  };

  const shareFullGuide = async () => {
    const text =
      "LibApp Editor — пошаговая инструкция\n\n" +
      SECTIONS.map((s) => `${s.title}\n\n${s.body}`).join("\n\n---\n\n");
    const uri = (FileSystem.cacheDirectory || "") + "libapp_editor_guide.txt";
    await FileSystem.writeAsStringAsync(uri, text, { encoding: "utf8" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Инструкция" });
    } else {
      dialog.alert("Гид", "Сохранено: " + uri);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.h0} selectable>Инструкция для начинающих</Text>
      <Text style={styles.lead} selectable>
        Читай по порядку. Не обязательно всё сразу — открой нужный пункт. В конце можно выгрузить весь текст
        себе в файлы.
      </Text>

      {SECTIONS.map((s) => (
        <Accordion
          key={s.id}
          section={s}
          open={openId === s.id}
          onToggle={() => setOpenId(openId === s.id ? null : s.id)}
        />
      ))}

      <TouchableOpacity style={styles.btn} onPress={shareFullGuide}>
        <Text style={styles.btnText} selectable>Поделиться всей инструкцией (.txt)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btnOutline} onPress={shareScript}>
        <Text style={styles.btnOutlineText} selectable>Поделиться resign.sh (подпись APK на ПК)</Text>
      </TouchableOpacity>

      <Text style={styles.foot} selectable>
        LibApp Editor · справка встроена в приложение · сначала Analyze, потом патч
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  h0: { color: colors.gold, fontWeight: "800", fontSize: 22, marginBottom: 8 },
  lead: { color: colors.textSecondary, lineHeight: 20, marginBottom: 16, fontSize: 14 },
  acc: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  accHead: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  accTitle: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 15, lineHeight: 20 },
  accChevron: { color: colors.gold, fontSize: 12 },
  accBody: {
    color: colors.textSecondary,
    paddingHorizontal: 14,
    paddingBottom: 14,
    lineHeight: 22,
    fontSize: 14,
  },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  btnText: { color: colors.onGold, fontWeight: "800" },
  btnOutline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700" },
  foot: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: 20,
    lineHeight: 18,
  },
});
