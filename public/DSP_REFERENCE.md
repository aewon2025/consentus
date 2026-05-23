# CONSENTUS X-LUCIS v2.0 // AUDIO DSP TECHNICAL KNOWLEDGE BASE

--------------------------------------------------------------------------------
DOCUMENT ID: KB-DSP-9042
AUTHOR: Google AI Studio Coding Agent
TARGET AUDIENCE: Audio Engineers, Meditation Leads, Project Lead (Dragonheart)
--------------------------------------------------------------------------------

This document serves as the official operational guide and technical reference for the Consentus X-Lucis v2.0 DSP Architecture. It answers critical engineering questions regarding transient handling, phase coherency, frequency alignment, and internal audio signal routing.

================================================================================
SECTION 1: THE "SCRATCHY/STUTTERING SOUND" PHENOMENON (TECHNO & ELECTRONIC MUSIC)
================================================================================

--- QUESTION ---
Why did techno/complex electronic music sound scratchy, metallic, stuttery, or flanged when we loaded it, resolving only when the DSP modules (especially the 432Hz alignment) were turned off?

--- THE TECHNICAL ANSWER ---
The scratchy and degraded audio you experienced when playing techno is the result of real-time Fourier Domain Pitch-Shifting (specifically designed to align standard A=440Hz master tracks to the A=432Hz Pythagorean tuning).

Here is exactly what happens mathematically:

1. Dynamic Time-Stretching & Pitch-Shifting:
   To lower a track's pitch from A=440Hz to A=432Hz without slowing down its tempo, the Web Audio DSP engine must perform continuous, real-time overlapping Fast Fourier Transforms (FFT). It slices the audio into millisecond-sized frames, analyzes their content, shifts the frequency components, and then windows-and-adds the frames back together.

2. Heavy Transient Degradation:
   - Techno, House, and electronic music rely on hard, immediate transients: solid, sharp 808/909 kick drums, crispy hi-hats, and rhythmic synth stabs.
   - FFT-based time-stretching "smears" these rapid transients across time bins. The transient's vertical energy spikes are blurred during frame re-synthesis, causing them to sound "soft" or "split."

3. Phase Cancelling & Metallic Artifacts (Comb Filtering):
   - Dense electronic tracks contain massive amounts of synchronized synthesizer harmonics and sidechain compression.
   - When the pitch-shifter splits these waveforms to decrease the frequency by a ratio of ~0.9818 (Pitch ratio to shift 440Hz to 432Hz), the wave phases become misaligned relative to each other.
   - This phase discrepancy creates "comb filtering" (a flanging, metallic phase cancellation) and micro-gaps between re-aligned audio frames, resulting in a scratchy, "crackling" texture instead of clean, analog punch.

--- THE CRUCIAL RESOLUTION ---
- For dense, fast electronic music containing rapid percussive transients and rich sidechained synthesizer frequencies, click "BYPASS ALL DSP". Electronic tracks are highly maximized and engineered; playing them raw (clean linear output) prevents phase corruption.
- For ambient, acoustic, slow vocal, or soundscapes, click "OPTIMIZE ALIGNMENT" to engage the 432Hz alignment, as their flowing, non-transient characteristics are fully compatible with Fourier phase stretching!


================================================================================
SECTION 2: ZEN TONE ROUTING & DSP INTERACTION
================================================================================

--- QUESTION ---
When clicking the Zen Tones (Solfeggio frequencies, Schumann Resonance, Drone, etc.), is the DSP (EQ, 432Hz Alignment, Pitch-shifter) active on those tones as well, or is that only for the microphone and MP3 files?

--- THE TECHNICAL ANSWER ---
The Zen Tones bypass the heavy input DSP modules (EQ, 432Hz Alignment peak filters, and Pitch Shifter) and connect directly to the Master Mixer Bus. 

Here is the exact signal flow of the Consentus X-Lucis engine:

                          +----------------------+
                          |  MP3 File / Mic In   |
                          +----------+-----------+
                                     |
                                     v
                          +----------+-----------+
                          |   10-Band EQ Engine  |
                          +----------+-----------+
                                     |
                                     v
                          +----------+-----------+
                          | Harmonic Core (432)  |  <--- Alignment peak filters
                          +----------+-----------+
                                     |
                                     v
                          +----------+-----------+
                          |  Pitch-Shifter Node  |  <--- 432Hz pitch shift
                          +----------+-----------+
                                     |
                                     v
                                     |                   +----------------------+
                                     |                   |  Zen Tones Generator |
                                     |                   | (Sine Wave Drones,   |
                                     |                   |  Solfeggio, Noise)  |
                                     |                   +-----------+----------+
                                     |                               |
                                     v                               v
                         +-----------+-------------------------------+----------+
                         |                    Master Gain Mixer Node            |
                         +---------------------------+--------------------------+
                                                     |
                                                     v
                         +---------------------------+--------------------------+
                         |                Dynamics Compressor & Limiter         |
                         +---------------------------+--------------------------+
                                                     |
                                                     v
                         +---------------------------+--------------------------+
                         |                     Stereo Panner Node               |
                         +---------------------------+--------------------------+
                                                     |
                                                     v
                         +---------------------------+--------------------------+
                         |                    Master Audio Analyser             |
                         +---------------------------+--------------------------+
                                                     |
                                                     v
                                              PHYSICAL OUTPUT (Speakers/Record)

--- WHY THIS ARCHITECTURE WAS SELECTED ---

1. Preserving Mathematical Purity:
   Zen Tones (such as Solfeggio 528Hz, or Schumann Resonance 7.83Hz) are generated locally as mathematically pure, crystal-clear sine waves. 
   - If we ran these pure waveforms through the Pitch Shifter, the engine would attempt to shift them, thereby altering and corrupting the specific healing resonance you selected. E.g., a pure 528Hz Solfeggio tone would get pitch-shifted to an unaligned frequency!
   - Similarly, the 10-Band Graphic EQ is tuned for coloring multi-frequency master files (like a loaded song) and should not distort our scientific drone sine waves!

2. Combined Master Processing (Limiting, Panning & Analysis):
   Even though Zen Tones bypass the coloring DSP, they combine with your loaded MP3 file at the Master Gain Mixer. 
   - Together, both sources pass through the Master Compressor/Limiter to prevent sound clipping.
   - They both respond to the Stereo Panner controls.
   - They are both visualized on the 32,768-point fast-response Analyser.
   - They are BOTH recorded during the Master Capture cycle!

Conclusively: Zen Tones are kept mathematically pure at point-of-generation, while MP3 files receive maximum engineering alignment!


================================================================================
SECTION 3: THE INFRASOUND & SPEAKER FREQUENCY COHERENCY MYSTERY (7.83Hz - 174Hz)
================================================================================

--- QUESTION ---
Why is it that when clicking on the individual "7.83" Zen Tone, there is no audible sound, but clicking on the "Schumann" environment preset produces sound? In fact, why are individual tones below "174" barely audible, if audible at all?

--- THE TECHNICAL ANSWER ---
This is a standard physical phenomenon combining Web Audio wave theory, human audiology, and hardware transducer physics:

1. Human Hearing Threshold & Fletcher-Munson Curves (Biological Factors):
   - Standard human hearing matches a frequency spectrum of 20Hz to 20,000Hz (20kHz).
   - Our auditory sensitivity is NOT flat; it is governed by the Fletcher-Munson Equal-Loudness Contours. Human hearing is evolutionary designed to be highly sensitive to the mid-frequencies (1,000Hz - 4,000Hz) where human speech and high-pitched warnings exist.
   - Conversely, our ears are extremely insensitive to low-end bass. A low frequency (like 54Hz or 108Hz) requires a sound pressure level (dB SPL) many times greater than a 1,000Hz tone to be perceived at the same apparent volume. At lower volume levels, these lower pitches fall completely below our audiological sensitivity threshold.
   - Age-related factors also impact low-to-mid sensitivity. While children can feel low rumbles and high whistles, adult ears gradually experience natural compression or loss of dynamic responsiveness inside the cochlea, meaning low and extremely high frequencies are the first to fade out at normal listener amplitudes.
   - The fundamental Schumann frequency of 7.83Hz, as well as its harmonics 14.3Hz and 20.8Hz, are classified as "Infrasound"—literally below the human biological hearing capacity. We cannot "hear" a pure 7.83Hz air pressure wave; it can only be felt as deep physical vibration when using specialized industrial subwoofers, tactile transducers, or bone-conduction therapy devices.

2. Acoustic Room Cancellations & Physical Environment (Space Factors):
   - Low frequencies have extremely long physical wavelengths (a 50Hz wave is approximately 22 feet long; a 7.83Hz wave is over 140 feet long).
   - In standard rooms, these long waves bounce off walls, ceiling, and floors and collide with themselves. If a peak meets a valley of a reflected wave, it causes complete "phase cancellation"—producing dead zones in your room where that specific bass frequency is completely inaudible.

3. Physical Speaker Hardware Limits (Transducer Factors):
   - Common consumer speakers (found in smartphones, laptops, desktop screens, and standard earbuds) are physically incapable of reproducing low frequencies below ~100Hz–150Hz.
   - Producing low-frequency sound waves requires a large speaker cone (diaphragm) with heavy excursion to move large volumes of air. The tiny drivers inside laptops and smartphones simply have no physical capacity to move that air; they filter out these frequencies completely to protect their tiny hardware coils from burning up.
   - This is why you cannot hear pure 54Hz, 108Hz, or 120Hz on standard mobile/laptop setups, and only start hearing clean, distinct vibrations once you reach 174Hz and above, which falls into the upper bass frequency register.

4. The Airtight Isolation "Seal" (Headphone Factors):
   - If you are wearing earbuds or open-back headphones, any gap in the seal between the speaker cushion and your ear canal allows the trapped low-frequency pressure waves to escape instantly into the room.
   - Without an airtight physical seal, low-bass tones (54Hz - 120Hz) undergo a dramatic natural roll-off of up to 24dB, rendering them completely silent. High-quality closed-back, well-sealed studio headphones are required to couple low-frequency waves to your inner ear.

5. The "Carrier Frequency" Magic in the "Schumann & Drone" Presets:
   - When you click the individual "7.83" button, the engine generates ONLY a mathematically pure 7.83Hz sine wave. It is completely silent on standard speakers because it is infrasound and has no harmonic carrier.
   - However, when you click the "Schumann" environment preset, the engine generates a *Harmonic Stack* consisting of: [7.83Hz, 14.3Hz, 20.8Hz, AND 432Hz].
   - The inclusion of the 432Hz frequency acts as an audible carrier tone. Because 432Hz is highly audible to human ears and easily reproduced by standard speakers, you instantly hear a beautiful, clear harmonic hum. The 7.83Hz and sub-20Hz tones ride on top of this carrier, interacting constructively to entrain your brain while remaining safe for small speakers!
   - The same principle applies to the "Drone" preset, which stacks [54Hz, 108Hz, 216Hz, and 432Hz]—the 216Hz and 432Hz waves provide the rich, humming body that lets your ears perceive the deep, underlying 54Hz and 108Hz bass lines.
