# Consentus X-Lucis - Mobile Deployment Guide

This guide explains how to package this web application as a native mobile app for Android and iOS using **Ionic Capacitor**.

## Prerequisites

1.  **Node.js**: Ensure you have Node.js installed.
2.  **Native Tools**:
    *   **Android**: Install [Android Studio](https://developer.android.com/studio).
    *   **iOS**: Install [Xcode](https://developer.apple.com/xcode/) (requires a Mac).

## 1. Installation

Install the necessary dependencies in your project:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init
```

*   **App name**: Consentus X-Lucis v2.0
*   **App ID**: com.consentus.xlucis

## 2. Build the Web App

Before adding native platforms, you must build the production-ready web assets:

```bash
npm run build
```

The build output will be in the `dist` directory.

## 3. Add Native Platforms

```bash
# Add Android support
npx cap add android

# Add iOS support
npx cap add ios
```

## 4. Permissions (Crucial for Audio)

Since this app uses the microphone for real-time processing, you MUST declare the permissions in the native files.

### Android (`android/app/src/main/AndroidManifest.xml`)

Add these lines inside the `<manifest>` tag:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

### iOS (`ios/App/App/Info.plist`)

Add these keys to your `Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>SonicBlast needs microphone access to process real-time audio and apply EQ filters.</string>
```

## 5. Running the App

### Android
```bash
npx cap open android
```
This will open the project in Android Studio. From there, you can connect your phone and click **Run**.

### iOS
```bash
npx cap open ios
```
This will open the project in Xcode. Select your connected device and click the **Play** button.

## 6. Syncing Changes

Every time you make changes to your React code and want to see them on your phone:

```bash
npm run build
npx cap sync
```

---

*Note: For the best performance on mobile, ensure your device supports WebGL for the visualizers and Web Audio API for the engine.*
