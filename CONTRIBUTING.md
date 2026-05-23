# Contributing to Consentus X-Lucis

First off, thank you for considering contributing to Consentus! It is people like you that make this a powerful tool for the community.

## The "Frequency Purity" Rule

This is the most important rule of the project: **Do not modify core frequency constants.**

If you are proposing a change to `src/lib/frequencyCore.ts` or the DSP logic in `src/App.tsx`:
1. It must be for the purpose of **increasing mathematical precision**.
2. It must not introduce audio distortion or latency that compromises the 7.83Hz Schumann detection.
3. If you want to add NEW frequencies, please add them to a "User Extensions" module rather than modifying the core scale.

## How to Contribute

1. **Reporting Bugs**: Use GitHub Issues. Please include your OS and browser, as Web Audio API behavior varies between Chrome, Safari, and Firefox.
2. **Feature Requests**: We love new ideas! Please open a Discussion or an Issue to talk about it first.
3. **Pull Requests**:
   - Ensure you run `npm run lint` before submitting.
   - Maintain the "Technical Brutalist" UI aesthetic.
   - Document any changes to the audio signal chain.

## Community & Feedback

If you have specific ideas for different meditative protocols, feel free to reach out to the Project Lead at visiolucis2025@gmail.com.

Stay aligned.
