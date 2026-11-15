/**
 * Detection & ranking of paid / premium feature markers in libapp.so
 * Used by PremiumScan + Analyze for highlighting.
 */

import { findAll, bufferToHex } from "./binary";
import { findBoolsNear } from "./unlock";

export type FeatureCategory =
  | "pro_getter"
  | "pro_flag"
  | "subscription"
  | "iap"
  | "ads"
  | "paywall"
  | "trial"
  | "other";

export interface FeatureDef {
  key: string;
  category: FeatureCategory;
  /** higher = more important for unlock */
  weight: number;
  label: string;
}

/** Ordered: more specific / high-value first for display */
export const FEATURE_DEFS: FeatureDef[] = [
  // Strong PRO getters (Flutter/Dart style)
  { key: "get:ownsPro", category: "pro_getter", weight: 100, label: "Getter ownsPro" },
  { key: "get:isPro", category: "pro_getter", weight: 98, label: "Getter isPro" },
  { key: "get:voicePro", category: "pro_getter", weight: 90, label: "Getter voicePro" },
  { key: "get:servingAdsNow", category: "ads", weight: 85, label: "Getter ads serving" },
  { key: "get:ownedProductId", category: "iap", weight: 88, label: "Owned product id" },
  { key: "get:noAdsTitle", category: "ads", weight: 70, label: "No-ads title" },
  { key: "get:pro", category: "pro_getter", weight: 80, label: "Getter pro" },

  { key: "ownsPro", category: "pro_flag", weight: 95, label: "ownsPro" },
  { key: "isPro", category: "pro_flag", weight: 92, label: "isPro" },
  { key: "isPremium", category: "pro_flag", weight: 90, label: "isPremium" },
  { key: "hasPremium", category: "pro_flag", weight: 88, label: "hasPremium" },
  { key: "checkPremium", category: "pro_flag", weight: 86, label: "checkPremium" },
  { key: "proUser", category: "pro_flag", weight: 84, label: "proUser" },
  { key: "premiumUser", category: "pro_flag", weight: 84, label: "premiumUser" },
  { key: "isVip", category: "pro_flag", weight: 82, label: "isVip" },
  { key: "isPaid", category: "pro_flag", weight: 80, label: "isPaid" },
  { key: "isUnlocked", category: "pro_flag", weight: 78, label: "isUnlocked" },
  { key: "proRequired", category: "paywall", weight: 88, label: "proRequired" },
  { key: "proPerks", category: "paywall", weight: 75, label: "proPerks" },
  { key: "ProPerk", category: "paywall", weight: 74, label: "ProPerk" },

  { key: "isSubscribed", category: "subscription", weight: 88, label: "isSubscribed" },
  { key: "hasSubscription", category: "subscription", weight: 86, label: "hasSubscription" },
  { key: "subscription", category: "subscription", weight: 50, label: "subscription" },
  { key: "subscribe", category: "subscription", weight: 48, label: "subscribe" },
  { key: "lifetime", category: "subscription", weight: 70, label: "lifetime" },
  { key: "isLifetime", category: "subscription", weight: 72, label: "isLifetime" },

  { key: "purchased", category: "iap", weight: 80, label: "purchased" },
  { key: "PurchaseStatus", category: "iap", weight: 78, label: "PurchaseStatus" },
  { key: "PurchaseDetails", category: "iap", weight: 76, label: "PurchaseDetails" },
  { key: "queryPastPurchases", category: "iap", weight: 74, label: "queryPastPurchases" },
  { key: "buyNonConsumable", category: "iap", weight: 72, label: "buyNonConsumable" },
  { key: "completePurchase", category: "iap", weight: 70, label: "completePurchase" },
  { key: "purchaseStream", category: "iap", weight: 68, label: "purchaseStream" },
  { key: "InAppPurchase", category: "iap", weight: 65, label: "InAppPurchase" },
  { key: "in_app_purchase", category: "iap", weight: 65, label: "in_app_purchase" },
  { key: "ProductDetails", category: "iap", weight: 60, label: "ProductDetails" },
  { key: "BillingClient", category: "iap", weight: 55, label: "BillingClient" },
  { key: "isPurchase", category: "iap", weight: 58, label: "isPurchase" },
  { key: "buyPro", category: "iap", weight: 75, label: "buyPro" },

  { key: "paywall", category: "paywall", weight: 70, label: "paywall" },
  { key: "Paywall", category: "paywall", weight: 70, label: "Paywall" },
  { key: "showPaywall", category: "paywall", weight: 72, label: "showPaywall" },
  { key: "premium", category: "paywall", weight: 40, label: "premium (generic)" },

  { key: "noAds", category: "ads", weight: 65, label: "noAds" },
  { key: "removeAds", category: "ads", weight: 64, label: "removeAds" },
  { key: "servingAds", category: "ads", weight: 62, label: "servingAds" },
  { key: "showAds", category: "ads", weight: 55, label: "showAds" },
  { key: "AdMob", category: "ads", weight: 40, label: "AdMob" },
  { key: "AppLovin", category: "ads", weight: 40, label: "AppLovin" },
  { key: "interstitial", category: "ads", weight: 35, label: "interstitial" },
  { key: "rewardedAd", category: "ads", weight: 35, label: "rewardedAd" },

  { key: "trial", category: "trial", weight: 50, label: "trial" },
  { key: "freeTrial", category: "trial", weight: 55, label: "freeTrial" },
  { key: "isFree", category: "trial", weight: 45, label: "isFree" },
  { key: "freeUser", category: "trial", weight: 45, label: "freeUser" },
  { key: "entitled", category: "other", weight: 60, label: "entitled" },
  { key: "isActive", category: "other", weight: 30, label: "isActive" },
  { key: "unlocked", category: "other", weight: 35, label: "unlocked" },
];

export const CATEGORY_META: Record<
  FeatureCategory,
  { title: string; color: string; short: string }
> = {
  pro_getter: { title: "PRO getters", color: "#E74C3C", short: "GET" },
  pro_flag: { title: "PRO flags", color: "#E67E22", short: "PRO" },
  subscription: { title: "Подписка", color: "#9B59B6", short: "SUB" },
  iap: { title: "In-App Purchase", color: "#3498DB", short: "IAP" },
  ads: { title: "Реклама", color: "#1ABC9C", short: "ADS" },
  paywall: { title: "Paywall", color: "#F1C40F", short: "PAY" },
  trial: { title: "Trial / Free", color: "#95A5A6", short: "TRL" },
  other: { title: "Прочее", color: "#7F8C8D", short: "OTH" },
};

export interface FeatureHit {
  key: string;
  label: string;
  category: FeatureCategory;
  weight: number;
  offset: number;
  hexOffset: string;
  context: string;
  boolsFalse: number;
  boolsTrue: number;
  /** 0–100 visual priority */
  score: number;
  highlight: "critical" | "high" | "medium" | "low";
}

function printableCtx(buf: Uint8Array, off: number, before = 8, after = 28): string {
  const start = Math.max(0, off - before);
  const end = Math.min(buf.length, off + after);
  let s = "";
  for (let i = start; i < end; i++) {
    const c = buf[i];
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
  }
  return s;
}

function scoreHit(
  def: FeatureDef,
  boolsFalse: number,
  boolsTrue: number
): { score: number; highlight: FeatureHit["highlight"] } {
  let score = def.weight;
  // Nearby false bools slightly boost "interesting for patch" but NOT proof
  if (boolsFalse > 0) score += Math.min(8, boolsFalse);
  if (def.category === "pro_getter") score += 5;
  score = Math.min(100, score);

  let highlight: FeatureHit["highlight"] = "low";
  if (score >= 90) highlight = "critical";
  else if (score >= 75) highlight = "high";
  else if (score >= 55) highlight = "medium";
  return { score, highlight };
}

/**
 * Full premium feature scan with ranking for UI highlighting.
 */
export function scanPremiumFeatures(
  buf: Uint8Array,
  opts: { maxPerKey?: number; boolRadius?: number } = {}
): FeatureHit[] {
  const maxPerKey = opts.maxPerKey ?? 12;
  const boolRadius = opts.boolRadius ?? 768;
  const enc = new TextEncoder();
  const seen = new Set<number>();
  const hits: FeatureHit[] = [];

  for (const def of FEATURE_DEFS) {
    const pat = enc.encode(def.key);
    const offs = findAll(buf, pat, maxPerKey);
    for (const offset of offs) {
      // Dedup overlapping: keep higher weight if same offset
      if (seen.has(offset)) {
        const existing = hits.find((h) => h.offset === offset);
        if (existing && def.weight > existing.weight) {
          existing.key = def.key;
          existing.label = def.label;
          existing.category = def.category;
          existing.weight = def.weight;
          const { score, highlight } = scoreHit(def, existing.boolsFalse, existing.boolsTrue);
          existing.score = score;
          existing.highlight = highlight;
        }
        continue;
      }
      seen.add(offset);

      // Skip bool scan for very generic low-weight keys to save time
      let boolsFalse = 0;
      let boolsTrue = 0;
      if (def.weight >= 55) {
        const bools = findBoolsNear(buf, offset, boolRadius);
        boolsFalse = bools.filter((b) => !b.isTrue).length;
        boolsTrue = bools.filter((b) => b.isTrue).length;
      }

      const { score, highlight } = scoreHit(def, boolsFalse, boolsTrue);
      hits.push({
        key: def.key,
        label: def.label,
        category: def.category,
        weight: def.weight,
        offset,
        hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
        context: printableCtx(buf, offset),
        boolsFalse,
        boolsTrue,
        score,
        highlight,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.offset - b.offset);
  return hits;
}

export function summarizeFeatures(hits: FeatureHit[]): {
  byCategory: Record<string, number>;
  critical: number;
  high: number;
  topKeys: string[];
} {
  const byCategory: Record<string, number> = {};
  let critical = 0;
  let high = 0;
  for (const h of hits) {
    byCategory[h.category] = (byCategory[h.category] || 0) + 1;
    if (h.highlight === "critical") critical++;
    if (h.highlight === "high") high++;
  }
  const topKeys = [...new Set(hits.filter((h) => h.score >= 75).map((h) => h.key))].slice(0, 12);
  return { byCategory, critical, high, topKeys };
}

export function highlightColor(h: FeatureHit): string {
  if (h.highlight === "critical") return "#E74C3C";
  if (h.highlight === "high") return "#E67E22";
  if (h.highlight === "medium") return "#F1C40F";
  return CATEGORY_META[h.category]?.color || "#7F8C8D";
}
