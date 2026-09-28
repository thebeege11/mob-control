# Shipping Swarm Surge to the App Store & Google Play

The game ships as a Capacitor 8 app. The web bundle (`dist/`) is copied into
the native projects in `ios/` and `android/`.

## One-time setup

- **iOS:** macOS, Xcode 16+ and an Apple Developer account.
- **Android:** Android Studio (SDK 36) and a Google Play Console account.
- Change the bundle id if you want to: `appId` in `capacitor.config.ts`
  (currently `com.swarmsurge.game`).
  - iOS: also update the Bundle Identifier in Xcode.
  - Android: also update `applicationId` in `android/app/build.gradle`.

## Build loop

```bash
npm run build && npx cap sync       # after any web change
npx cap open ios                    # Xcode → Product → Archive → Distribute
npx cap open android                # Android Studio → Build → Generate Signed Bundle (AAB)
```

- **Versioning.**
  - iOS: `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode.
  - Android: `versionName` / `versionCode` in `android/app/build.gradle`.
- **Icons and splash.** Regenerate from `resources/` with `npm run assets`.
  It uses headless Chromium via Playwright. It writes:
  - every Android mipmap and splash
  - the iOS 1024 app icon
  - `resources/store-icon-512.png` for the Play listing
- **Orientation.** Locked to portrait on both platforms, with the status bar
  hidden on iOS.

## Replace the mock services before release

All of these sit behind interfaces. Implement one class each and pass it in
`src/main.ts` through `new GameManager(canvas, ui, toasts, { ads, store })`.

| Interface | File | Suggested SDK |
|---|---|---|
| `AdProvider` | `src/systems/AdManager.ts` | AdMob (`@capacitor-community/admob`) or AppLovin MAX |
| `StoreProvider` | `src/systems/PurchaseManager.ts` | RevenueCat (`@revenuecat/purchases-capacitor`) or `cordova-plugin-purchase` |
| `AnalyticsProvider` | `src/systems/AnalyticsManager.ts` | Firebase Analytics, GameAnalytics or Amplitude |

- **Product ids:** `remove_ads` (non-consumable), `gems_small` and
  `gems_large` (consumables), `skin_pack_neon` (non-consumable). Create the
  same ids in App Store Connect and in Play Console.
- **Ad policy** (in `TUNING.ads`):
  - Rewarded ads are always optional.
  - Interstitials only appear after level 6, at most once every 4
    completions and 180 s, never after a failure, and never with Remove Ads.
- **Required by the stores:**
  - Add **ATT** (the iOS App Tracking Transparency prompt) before you
    initialise personalised ads.
  - Add a **UMP/CMP consent** flow for EEA/UK users.
  - Declare data collection in the Play Data Safety form and the App Store
    privacy nutrition labels. The game itself collects nothing: no accounts,
    fully offline, saves stay on the device.
- **Restore purchases** is already in the Settings and Shop screens, as Apple
  requires.

## Pre-submission checklist

- [ ] `npm test` green, `npm run e2e` green
- [ ] Real ad / IAP / analytics providers wired, test ads verified, sandbox purchases verified
- [ ] Remove the `?debug` params, or leave them: they only work in dev builds or with the explicit `?debug` flag
- [ ] Privacy policy URL (required by both stores even for offline games with ads)
- [ ] Age rating: cartoon violence, mild (enemies "pop"), with ads
- [ ] Screenshots: use `?debug&level=N&autoplay` on a device simulator to capture boss fights, big swarms and gate choices
- [ ] Test on a low-end Android device (adaptive resolution drops the render scale automatically if FPS falls below 45)
- [ ] Android back button: pauses the game, closes menus, then minimises the app
