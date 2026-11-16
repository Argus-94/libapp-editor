import "react-native-gesture-handler";
import React, { Component, ErrorInfo, ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { Text, StyleSheet, View, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, applyAccent, Accent } from "./src/theme";
import { AppProvider, useAppFile } from "./src/store/AppContext";
import { DialogProvider } from "./src/components/DialogProvider";
import { logger } from "./src/utils/logger";
import { APP_VERSION } from "./src/version";
import { loadSettings } from "./src/store/storage";

import HomeScreen from "./src/screens/HomeScreen";
import ResultsScreen from "./src/screens/ResultsScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import PresetsScreen from "./src/screens/PresetsScreen";
import PresetEditScreen from "./src/screens/PresetEditScreen";
import CompareScreen from "./src/screens/CompareScreen";
import BookmarksScreen from "./src/screens/BookmarksScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ApkScreen from "./src/screens/ApkScreen";
import HelpScreen from "./src/screens/HelpScreen";
import PremiumScanScreen from "./src/screens/PremiumScanScreen";
import AutoUnlockScreen from "./src/screens/AutoUnlockScreen";
import AnalyzeScreen from "./src/screens/AnalyzeScreen";
import ManualPatchScreen from "./src/screens/ManualPatchScreen";
import ImportDumpScreen from "./src/screens/ImportDumpScreen";
import LogcatScreen from "./src/screens/LogcatScreen";
import WizardScreen from "./src/screens/WizardScreen";
import QueueScreen from "./src/screens/QueueScreen";

// Keep native splash until first React frame paints — prevents white flash on Android/iOS
SplashScreen.preventAutoHideAsync().catch(() => {});

enableScreens(true);

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    primary: colors.gold,
    border: colors.border,
  },
};

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      logger.error("ErrorBoundary", error.message, info?.componentStack || "");
    } catch {
      /* ignore */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorRoot}>
          <Text style={styles.errorTitle}>Ошибка запуска</Text>
          <Text style={styles.errorVer}>v{APP_VERSION}</Text>
          <ScrollView style={styles.errorScroll}>
            <Text style={styles.errorBody}>{String(this.state.error?.message || this.state.error)}</Text>
            <Text style={styles.errorBody}>
              {String((this.state.error as any)?.stack || "").slice(0, 2000)}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.gold,
  headerTitleStyle: { fontWeight: "700" as const },
  contentStyle: { backgroundColor: colors.background },
};

/** Tab 4 — tools ordered by workflow */
function MoreStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="ToolsHome"
        component={SettingsScreen}
        options={{ title: "Инструменты" }}
      />
      <Stack.Screen name="Wizard" component={WizardScreen} options={{ title: "Мастер патча" }} />
      <Stack.Screen name="Queue" component={QueueScreen} options={{ title: "Очередь патчей" }} />
      <Stack.Screen name="ManualPatch" component={ManualPatchScreen} options={{ title: "Manual Patch" }} />
      <Stack.Screen name="Presets" component={PresetsScreen} options={{ title: "Пресеты" }} />
      <Stack.Screen name="PresetEdit" component={PresetEditScreen} options={{ title: "Редактор пресета" }} />
      <Stack.Screen name="Compare" component={CompareScreen} options={{ title: "Сравнение .so" }} />
      <Stack.Screen name="Bookmarks" component={BookmarksScreen} options={{ title: "Закладки" }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: "Инструкция" }} />
      <Stack.Screen name="PremiumScan" component={PremiumScanScreen} options={{ title: "Платные функции" }} />
      <Stack.Screen name="AutoUnlock" component={AutoUnlockScreen} options={{ title: "Auto Unlock" }} />
      <Stack.Screen name="ImportDump" component={ImportDumpScreen} options={{ title: "Import dump" }} />
      <Stack.Screen name="Logcat" component={LogcatScreen} options={{ title: "Logcat" }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: "История патчей" }} />
    </Stack.Navigator>
  );
}

type IonName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(routeName: string, focused: boolean): IonName {
  const map: Record<string, [IonName, IonName]> = {
    FileTab: ["document-outline", "document-text"],
    AnalyzeTab: ["search-outline", "search"],
    PatchTab: ["build-outline", "build"],
    ApkTab: ["archive-outline", "archive"],
    MoreTab: ["menu-outline", "menu"],
  };
  const pair = map[routeName] || ["ellipse-outline", "ellipse"];
  return focused ? pair[1] : pair[0];
}

function MainTabs() {
  const { dirty, patchQueue } = useAppFile();
  const queueN = patchQueue.length;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.gold,
        headerTitleStyle: { fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={tabIcon(route.name, focused)} size={size ?? 22} color={color} />
        ),
      })}
    >
      <Tab.Screen
        name="FileTab"
        component={HomeScreen}
        options={{ title: "Файл", tabBarLabel: "Файл" }}
      />
      <Tab.Screen
        name="AnalyzeTab"
        component={AnalyzeScreen}
        options={{ title: "Анализ", tabBarLabel: "Анализ" }}
      />
      <Tab.Screen
        name="PatchTab"
        component={ManualPatchScreen}
        options={{
          title: "Патч",
          tabBarLabel: "Патч",
          tabBarBadge: dirty ? "•" : undefined,
          tabBarBadgeStyle: dirty
            ? { backgroundColor: colors.gold, color: colors.onGold, fontSize: 10, minWidth: 16, height: 16 }
            : undefined,
        }}
      />
      <Tab.Screen
        name="ApkTab"
        component={ApkScreen}
        options={{
          title: "APK",
          tabBarLabel: "APK",
          tabBarBadge: dirty ? "•" : undefined,
          tabBarBadgeStyle: dirty
            ? { backgroundColor: colors.gold, color: colors.onGold, fontSize: 10, minWidth: 16, height: 16 }
            : undefined,
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStack}
        options={{
          title: "Ещё",
          tabBarLabel: "Ещё",
          headerShown: false,
          tabBarBadge: queueN > 0 ? (queueN > 9 ? "9+" : String(queueN)) : undefined,
          tabBarBadgeStyle:
            queueN > 0
              ? { backgroundColor: colors.gold, color: colors.onGold, fontSize: 10 }
              : undefined,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadSettings();
        if (!cancelled && s?.accent) applyAccent(s.accent as Accent);
      } catch {
        /* default gold */
      }
      // Hide splash only after first paint so root dark background is already on screen
      requestAnimationFrame(() => {
        if (cancelled) return;
        SplashScreen.hideAsync().catch(() => {});
        try {
          logger.info("App", "start", { version: APP_VERSION });
        } catch {
          /* ignore */
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppProvider>
            <DialogProvider>
            <NavigationContainer theme={navTheme}>
              <StatusBar style="light" />
              <Stack.Navigator screenOptions={stackScreenOptions}>
                <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
                <Stack.Screen name="Results" component={ResultsScreen} options={{ title: "Результаты поиска" }} />
                <Stack.Screen name="ManualPatch" component={ManualPatchScreen} options={{ title: "Manual Patch" }} />
                <Stack.Screen name="Analyze" component={AnalyzeScreen} options={{ title: "Analyze Report" }} />
                <Stack.Screen name="PremiumScan" component={PremiumScanScreen} options={{ title: "Платные функции" }} />
                <Stack.Screen name="AutoUnlock" component={AutoUnlockScreen} options={{ title: "Auto Unlock" }} />
                <Stack.Screen name="ImportDump" component={ImportDumpScreen} options={{ title: "Import dump" }} />
                <Stack.Screen name="Compare" component={CompareScreen} options={{ title: "Сравнение .so" }} />
                <Stack.Screen name="Bookmarks" component={BookmarksScreen} options={{ title: "Закладки" }} />
                <Stack.Screen name="Help" component={HelpScreen} options={{ title: "Инструкция" }} />
                <Stack.Screen name="Presets" component={PresetsScreen} options={{ title: "Пресеты" }} />
                <Stack.Screen name="PresetEdit" component={PresetEditScreen} options={{ title: "Редактор пресета" }} />
                <Stack.Screen name="Logcat" component={LogcatScreen} options={{ title: "Logcat" }} />
                <Stack.Screen name="History" component={HistoryScreen} options={{ title: "История" }} />
                <Stack.Screen name="Wizard" component={WizardScreen} options={{ title: "Мастер патча" }} />
                <Stack.Screen name="Queue" component={QueueScreen} options={{ title: "Очередь патчей" }} />
              </Stack.Navigator>
            </NavigationContainer>
            </DialogProvider>
          </AppProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Match theme.background + app.json backgroundColor/splash — no white gap on launch
  root: { flex: 1, backgroundColor: colors.background },
  errorRoot: { flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 60 },
  errorTitle: { color: colors.danger, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  errorVer: { color: colors.textSecondary, marginBottom: 16 },
  errorScroll: { flex: 1 },
  errorBody: { color: colors.text, fontSize: 13, fontFamily: "monospace", marginBottom: 12 },
});
