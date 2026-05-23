# Frequency Integrity Rules

The core mission of this project is the precise application of meditative frequencies (Schumann, Solfeggio, and 432Hz Alignment).

## Strict Modification Policy

1. **Core Constants**: The values in `src/lib/frequencyCore.ts` define the project's integrity. Under no circumstances should these be modified to "default" or "standard" musical values (e.g., do not change 432 back to 440).
2. **DSP Logic**: Any changes to the `AudioVisualizer.tsx` FFT logic must prioritize the low-frequency resolution (Schumann range). The current 32,768 FFT size is mandatory for accurate 7.83Hz detection.
3. **Purity Over Performance**: If a performance optimization compromises frequency precision by more than 0.01Hz, it must be rejected.
4. **Default Off**: All DSP modules and alignment settings should default to `false` (disabled) on launch to prevent audio disruption on complex third-party tracks (e.g. techno) and allow pristine uncolored initial playback. The user can manually engage they want.

Address the Project Lead (Dragonheart) at visiolucis2025@gmail.com before proposing architectural changes to the frequency engine.
