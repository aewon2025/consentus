# 🧪 Consentus X-Lucis - Test Plan

This document outlines the critical testing protocols for **Consentus X-Lucis v2.0**. Use this plan to verify architectural stability and frequency purity before a public release.

---

## 1. Frequency Integrity & DSP (The Core)

| Test ID | Procedure | Expected Result |
|:---|:---|:---|
| FREQ-01 | Toggle **432Hz Alignment** while an MP3 is playing. | Pitch should shift down slightly (factor of ~0.98). No clicks or pops. |
| FREQ-02 | Select **Schumann (7.83Hz)** in Zen Modulator. | Spectrum peak should appear at the far left (sub-bass range). |
| FREQ-03 | Layer **963Hz (Solfeggio)** over a playing track. | Note detection should identify "B5" (approx) or 963Hz peak in diagnostics. |
| FREQ-04 | Enable **Limiter (DSP Module)**. | Output should normalize peaks; volume shouldn't clip even with multiple sources active. |

## 2. Multi-Source Layering (The Mix)

| Test ID | Procedure | Expected Result |
|:---|:---|:---|
| MIX-01 | Start MP3 + Ocean Environment + 528Hz Tone. | All three sources should play simultaneously without interference. |
| MIX-02 | Adjust **Master Gain** slider to 150%. | Volume increases across all layers synchronously. |
| MIX-03 | Change **Language** during playback. | Interface updates immediately; audio playback is NOT interrupted. |
| MIX-04 | Change **Environment** (Rain to Ocean). | Cross-fade should be smooth (if implemented) or instant without audio glitches. |

## 3. Visualization & Diagnostics

| Test ID | Procedure | Expected Result |
|:---|:---|:---|
| DIAG-01 | Expand **Spectrum Insights** during complex layering. | Analyzer should show energy distribution across all 7 bands accurately. |
| DIAG-02 | Observe **Peak Frequency** readout. | Should update in real-time, matching the loudest active frequency source. |
| DIAG-03 | Test Visualization in **Fullscreen** (if supported). | Frame rate should remain stable at 60fps (no stuttering). |

## 4. Capture & Storage

| Test ID | Procedure | Expected Result |
|:---|:---|:---|
| CAP-01 | Click **"Start Capture"**, play for 30s, click **"Stop"**. | A .webm or .wav file should be generated for download. |
| CAP-02 | Verify Captured Audio Quality. | Recorded file must include the 432Hz pitch shift and all active layers. |
| CAP-03 | Rapid Toggle (Start/Stop Capture). | System should handle rapid state changes without crashing the browser session. |

## 5. UI/UX & Localization

| Test ID | Procedure | Expected Result |
|:---|:---|:---|
| UI-01 | Test **Mobile Responsiveness**. | All controls must be accessible (44px min target) on mobile screens. |
| UI-02 | Switch through all 6 languages. | No "missing translation" keys should be visible. Check "Quick Guide" accuracy. |
| UI-03 | Scroll the **Solfeggio** list. | Custom scrollbar should be functional and not overlap button text. |

## 6. Environment & Compatibility

- **Browsers**: Test on Chrome (Desktop/Mobile), Safari (iOS), and Firefox.
- **Microphone Permissions**: Ensure "Refuse" permission doesn't crash the app (it should simply disable visualization).
- **Audio Context**: Ensure the "Confirm Operational Status" bridge correctly unlocks audio on mobile browsers.

---

### Regression Testing Rule
If `src/lib/frequencyCore.ts` is modified, ALL tests in Section 1 must be re-run immediately.
