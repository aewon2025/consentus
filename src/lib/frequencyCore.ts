/**
 * CONSENTUS CORE FREQUENCY MANIFESTO
 * 
 * This file contains the mathematical foundations of the Consentus X-Lucis engine.
 * The constants defined here are considered "Sacred Integrity" values.
 * 
 * RULES FOR MODIFICATION:
 * 1. Do NOT modify base frequencies (Solfeggio/Schumann) unless correcting to higher decimal precision.
 * 2. The 432Hz Alignment ratio (0.9818...) is derived from (432/440). Do not "round" this value further.
 * 3. Any experimental frequency additions must be categorized as "User Defined" and not overwrite Core values.
 */

export const CORE_FREQUENCIES = {
  // Earth's Heartbeat (Primary Resonance)
  SCHUMANN_RESONANCE: 7.83,
  
  // Solfeggio Scale (Pure Tones)
  SOLFEGGIO: {
    UT_396: 396, // Liberating Guilt and Fear
    RE_417: 417, // Undoing Situations and Facilitating Change
    MI_528: 528, // Transformation and Miracles (DNA Repair)
    FA_639: 639, // Connecting/Relationships
    SOL_741: 741, // Expression/Solutions
    LA_852: 852, // Returning to Spiritual Order
    XI_963: 963, // SENSE: Higher Self Communication
  },

  // The 432Hz Miracle Standard
  STANDARD_A: 440,
  ALIGNMENT_A: 432,
  
  // DSP Ratios
  get PITCH_RATIO_432HZ() {
    return this.ALIGNMENT_A / this.STANDARD_A; // Precisely 0.9818181818181818
  }
};

/**
 * Validates if a frequency shift is within the "Harmonic Purity" envelope.
 * Used to prevent accidental distortion during development.
 */
export const validateFrequencyIntegrity = (freq: number, target: number) => {
  const tolerance = 0.000001;
  return Math.abs(freq - target) < tolerance;
};
