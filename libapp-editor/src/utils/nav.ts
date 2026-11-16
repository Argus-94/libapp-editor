/** Navigate to a root-stack screen from nested tab/stack children */
export function navigateRoot(navigation: any, name: string, params?: object) {
  if (!navigation) return;
  let nav = navigation;
  while (nav?.getParent?.()) {
    nav = nav.getParent();
  }
  try {
    nav.navigate(name, params);
  } catch {
    try {
      navigation.navigate(name, params);
    } catch {
      /* ignore */
    }
  }
}

/** Switch main tab: FileTab | AnalyzeTab | PatchTab | ApkTab | MoreTab */
export function navigateTab(navigation: any, tab: string, params?: object) {
  if (!navigation) return;
  let nav = navigation;
  while (nav?.getParent?.()) {
    nav = nav.getParent();
  }
  try {
    nav.navigate("Main", { screen: tab, params });
  } catch {
    try {
      navigation.navigate(tab, params);
    } catch {
      /* ignore */
    }
  }
}

/** Open Manual Patch with optional offset (root stack screen) */
export function navigatePatch(navigation: any, offset?: number) {
  if (offset !== undefined && offset !== null) {
    navigateRoot(navigation, "ManualPatch", { initialOffset: offset });
  } else {
    navigateTab(navigation, "PatchTab");
  }
}
