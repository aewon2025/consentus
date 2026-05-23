import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  mode?: 'bars' | 'waveform';
  colorScheme?: 'vibrant' | 'mono' | 'fire';
  sensitivity?: number; // 0 to 1
  highlightedBand?: number | null; // index of the EQ band being adjusted
  isExpanded?: boolean;
  activeFrequencies?: string[];
  onStatsUpdate?: (stats: {
    peakFreq: number;
    rawFreq: number;
    note: string;
    rms: number;
    bands: { label: string; value: number }[];
    isLocked?: boolean;
    multiPeaks?: number[];
  }) => void;
}

export default function AudioVisualizer({ 
  analyser, 
  isActive, 
  mode = 'bars', 
  colorScheme = 'vibrant',
  sensitivity = 0.8,
  highlightedBand = null,
  isExpanded = false,
  activeFrequencies = [],
  onStatsUpdate
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const statsThrottleRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const floatDataRef = useRef<Float32Array | null>(null);

  const getNoteFromFreq = (freq: number) => {
    if (freq <= 0) return "--";
    if (freq < 16) return "SUB"; // Below lowest piano note
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const h = 12 * Math.log2(freq / 440) + 69;
    if (isNaN(h) || !isFinite(h)) return "--";
    const noteIndex = ((Math.round(h) % 12) + 12) % 12;
    const octave = Math.floor(h / 12) - 1;
    return notes[noteIndex] + octave;
  };

  useEffect(() => {
    if (analyser) {
      analyser.smoothingTimeConstant = sensitivity;
    }
  }, [analyser, sensitivity]);

  useEffect(() => {
    if (!analyser || !isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Dynamically get current buffer size in case fftSize changed
      const bufferLength = analyser.fftSize;
      const freqBinCount = analyser.frequencyBinCount;
      
      if (!dataArrayRef.current || dataArrayRef.current.length !== bufferLength) {
        dataArrayRef.current = new Uint8Array(bufferLength);
        floatDataRef.current = new Float32Array(freqBinCount);
      }
      
      const dataArray = dataArrayRef.current!;
      const floatData = floatDataRef.current!;
      const binWidth = analyser.context.sampleRate / bufferLength;

      // Always fetch frequency data for stats calculation if needed
      if (onStatsUpdate || mode === 'bars') {
        // Ensure analyser is sensitive to quiet sounds
        analyser.minDecibels = -110;
        analyser.maxDecibels = -10;
        
        analyser.getByteFrequencyData(dataArray);
        analyser.getFloatFrequencyData(floatData);
        
        // Stats Calculation
        if (onStatsUpdate && Date.now() - statsThrottleRef.current > 60) {
          let maxWeightedVal = -200; 
          let maxBin = -1;
          let sumSquares = 0;
          
          const bands = [
            { label: 'Sub', min: 2, max: 60, val: 0, count: 0 },
            { label: 'Bass', min: 60, max: 250, val: 0, count: 0 },
            { label: 'Low-Mid', min: 250, max: 500, val: 0, count: 0 },
            { label: 'Mid', min: 500, max: 2000, val: 0, count: 0 },
            { label: 'High-Mid', min: 2000, max: 4000, val: 0, count: 0 },
            { label: 'Presence', min: 4000, max: 6000, val: 0, count: 0 },
            { label: 'Brilliance', min: 6000, max: 20000, val: 0, count: 0 }
          ];

          // Use freqBinCount for frequency operations
          for (let i = 1; i < freqBinCount; i++) {
            let dbVal = floatData[i];
            // Handle -Infinity safely
            if (dbVal < -200) dbVal = -200;
            
            const byteVal = dataArray[i];
            
            // Calculate true RMS from byte data (scaled 0-1)
            sumSquares += (byteVal / 255) * (byteVal / 255);

            // Weighting for peak detection
            // Narrow and precise boost for Schumann (7.83Hz) - Bin ~5.8 at 44.1k
            // Precise boost for 432Hz alignment area
            let weight = 0; 
            const freq = i * binWidth;
            
            // Critical: Heavily weight frequencies the user has actually selected
            const isActive = activeFrequencies.some(af => Math.abs(parseFloat(af) - freq) < 1.0);
            if (isActive) weight += 60; // Major priority for active zen tones
            
            if (i < 3) weight = -100; // Total suppression for near-DC noise
            else if (freq >= 6 && freq <= 10) weight += 40; // Strong Schumann bias
            else if (freq >= 400 && freq <= 460) weight += 20; // 432Hz bias
            else if (freq < 100) weight += 15; // General bass boost
            
            const weightedDb = dbVal + weight;

            if (weightedDb > maxWeightedVal) {
              maxWeightedVal = weightedDb;
              maxBin = i;
            }

            const currentBand = bands.find(b => freq >= b.min && freq < b.max);
            if (currentBand) {
              if (byteVal > currentBand.val) currentBand.val = byteVal;
              currentBand.count++;
            }
          }

          let isLocked = false;
          let peakFreqValue = 0;
          if (maxBin !== -1) {
              // Gaussian interpolation on dB values
              let refinedMaxBin = maxBin;
              if (maxBin > 0 && maxBin < freqBinCount - 1) {
                const alpha = floatData[maxBin - 1];
                const beta = floatData[maxBin];
                const gamma = floatData[maxBin + 1];
                
                if (beta > alpha && beta > gamma && beta > -140) {
                  const denominator = 2 * (alpha - 2 * beta + gamma);
                  if (Math.abs(denominator) > 1e-6) {
                    const shift = (alpha - gamma) / denominator;
                    if (Math.abs(shift) < 1) refinedMaxBin = maxBin + shift;
                  }
                }
              }
              
              const rawMeasuredFreq = refinedMaxBin * binWidth;
              peakFreqValue = rawMeasuredFreq;

              // --- FREQUENCY INTEGRITY LOCK ---
              // Snap to sacred targets if within tolerance (0.20Hz)
              const targets = [
                7.83, 14.3, 20.8, 20.95, 54, 108, 120, 174, 216, 240, 285, 304, 324, 396, 417, 432, 528, 639, 741, 760, 802, 852, 963, 965, 1550, 6000, 10000
              ];
              
              // Multi-peak detection: Look for local maxima above a noise floor
              let multiPeaks: number[] = [];
              const rawThreshold = -105; // Lower noise floor to ensure Schumann detection
              
              // Detect discrete spectral peaks
              for (let i = 2; i < freqBinCount - 5; i++) {
                 const current = floatData[i];
                 // Check if it's a discrete peak (higher than immediate neighbors)
                 // For very low frequencies (Schumann), we use a softer delta to capture the broad resonance
                 const delta = (i < 15) ? 0.2 : 1.2;
                 
                 if (current > rawThreshold && 
                     current > floatData[i-1] + delta && 
                     current > floatData[i+1] + delta) {
                    
                    // Gaussian/Parabolic Interpolation inside the peak to show organic drift details
                    let refinedIndex = i;
                    if (i > 0 && i < freqBinCount - 1) {
                      const alpha = floatData[i - 1];
                      const beta = floatData[i];
                      const gamma = floatData[i + 1];
                      const denominator = 2 * (alpha - 2 * beta + gamma);
                      if (Math.abs(denominator) > 1e-6) {
                        const shift = (alpha - gamma) / denominator;
                        if (Math.abs(shift) < 1) {
                          refinedIndex = i + shift;
                        }
                      }
                    }
                    
                    const pFreq = refinedIndex * binWidth;
                    if (!multiPeaks.some(p => Math.abs(p - pFreq) < 5)) {
                       multiPeaks.push(pFreq);
                    }
                 }
                 if (multiPeaks.length > 15) break; 
              }
              
              // Update multiPeaks sort order: highest magnitude first
              multiPeaks.sort((a, b) => {
                const valA = floatData[Math.round(a / binWidth)] || -200;
                const valB = floatData[Math.round(b / binWidth)] || -200;
                return valB - valA;
              });

              // --- FREQUENCY CYCLING LOGIC ---
              // If multiple tones are active, we cycle the focus of the readout
              if (activeFrequencies.length > 1) {
                // Cycle every 1.5s for readability
                const cycleIndex = Math.floor(Date.now() / 1500) % activeFrequencies.length;
                const targetFreqVal = parseFloat(activeFrequencies[cycleIndex]);
                
                if (!isNaN(targetFreqVal)) {
                  // Find nearest peak in the spectrum to this chosen frequency
                  const nearestPeak = multiPeaks.find(p => Math.abs(p - targetFreqVal) < 4.0);
                  
                  if (nearestPeak) {
                    // Critical: In multi-tone mode, we return the raw measurement (nearestPeak) 
                    // so the user sees the real-audio drift instead of the theoretical number
                    peakFreqValue = nearestPeak;
                    // We check alignment strictly for the "Locked" light only
                    isLocked = targets.some(t => Math.abs(t - targetFreqVal) < 0.15);
                  } else {
                    peakFreqValue = targetFreqVal;
                    isLocked = targets.some(t => Math.abs(t - targetFreqVal) < 0.15);
                  }
                }
              } else {
                // Standard single-target logic with better snapping
                const primaryTarget = targets.find(t => activeFrequencies.some(af => Math.abs(parseFloat(af) - t) < 0.1));
                if (primaryTarget) {
                  const closePeak = multiPeaks.find(p => Math.abs(p - primaryTarget) < 1.0);
                  if (closePeak || Math.abs(rawMeasuredFreq - primaryTarget) < 1.0) {
                    peakFreqValue = primaryTarget;
                    isLocked = true;
                  }
                } else {
                   // Universal snap for any sacred target found in spectrum
                   for (const target of targets) {
                     if (Math.abs(rawMeasuredFreq - target) < 0.45) {
                       peakFreqValue = target;
                       isLocked = true;
                       break;
                     }
                   }
                }
              }
              
              const rms = Math.sqrt(sumSquares / freqBinCount);
              
              onStatsUpdate({
                peakFreq: peakFreqValue,
                rawFreq: rawMeasuredFreq,
                note: getNoteFromFreq(peakFreqValue),
                rms,
                bands: bands.map(b => ({ 
                  label: b.label, 
                  value: b.val / 255 
                })),
                isLocked,
                multiPeaks: multiPeaks.slice(0, 15)
              });
            }
            statsThrottleRef.current = Date.now();
          }
        }

      if (mode === 'bars') {
        // Frequency data already fetched above
        // Performance: Skip rendering very high irrelevant frequencies and downsample for visual clarity
        const visualLimit = Math.floor(20000 / binWidth); // Limit to 20kHz
        const step = Math.max(1, Math.floor(visualLimit / (width / 4))); // Group bins for smoother look
        const barWidth = (width / (visualLimit / step)) - 0.5; // Slight spacing
        
        let x = 0;
        const eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

        for (let i = 0; i < visualLimit; i += step) {
          // Average the group of bins for this bar
          let sumVal = 0;
          let count = 0;
          for (let j = 0; j < step && (i + j) < freqBinCount; j++) {
            sumVal += dataArray[i + j];
            count++;
          }
          const avgVal = sumVal / count;
          const barHeight = (avgVal / 255) * height;
          const currentFreq = i * binWidth;
          
          let isHighlighted = false;
          if (highlightedBand !== null) {
            const targetFreq = eqFrequencies[highlightedBand];
            const nextFreq = (i + step) * binWidth;
            if (targetFreq >= currentFreq && targetFreq < nextFreq) {
              isHighlighted = true;
            }
          }

          if (isHighlighted) {
             ctx.fillStyle = '#FFFFFF';
             ctx.shadowBlur = 15;
             ctx.shadowColor = '#FFFFFF';
          } else {
            // Check if this frequency is near an active tone
            const isActiveTone = activeFrequencies.some(f => {
              const freq = parseFloat(f);
              if (isNaN(freq)) return false;
              // Wider tolerance (0.5Hz or 5 bins whichever is larger)
              return Math.abs(freq - currentFreq) < Math.max(0.5, binWidth * 5);
            });

            if (isActiveTone) {
              ctx.fillStyle = '#00f2ff'; // ZEN CYAN
              ctx.shadowBlur = 15;
              ctx.shadowColor = '#00f2ff';
            } else if (colorScheme === 'vibrant') {
              // VIBRANT: Advanced Spectral Mapping (Non-linear hue for better contrast at low freq)
              // Use log-ish mapping to spread out the low-end colors
              const logRatio = Math.log10(i + 1) / Math.log10(visualLimit);
              const hue = (logRatio * 360 + 200) % 360; // Start at a nice cool blue/cyan
              const brightness = 45 + (avgVal / 255) * 25;
              ctx.fillStyle = `hsla(${hue}, 100%, ${brightness}%, ${0.65 + (avgVal / 255) * 0.35})`;
              ctx.shadowBlur = avgVal > 140 ? 12 : 0;
              ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
            } else if (colorScheme === 'fire') {
              // EARTHY CLAY: Warm Terracotta & Rich Sands
              const ratio = avgVal / 255;
              const r = Math.floor(139 + ratio * 80); 
              const g = Math.floor(90 + ratio * 60);  
              const b = Math.floor(43 + ratio * 20);  
              ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              ctx.shadowBlur = ratio * 15;
              ctx.shadowColor = '#A35D34';
            } else {
              // STEALTH: Technical Cyan (Professional & Sharp)
              const ratio = avgVal / 255;
              ctx.fillStyle = `rgba(0, 242, 255, ${0.15 + ratio * 0.7})`;
              ctx.shadowBlur = ratio * 8;
              ctx.shadowColor = '#00f2ff';
            }
          }

          ctx.fillRect(x, height - barHeight, barWidth, barHeight);

          // Render frequency markers for active tones (labels)
          if (isExpanded) {
            activeFrequencies.forEach(fStr => {
              const f = parseFloat(fStr);
              if (isNaN(f)) return;
              
              if (Math.abs(f - currentFreq) < Math.max(0.25, binWidth * 2)) {
                 ctx.save();
                 ctx.fillStyle = '#00f2ff';
                 ctx.font = 'bold 11px font-mono';
                 ctx.textAlign = 'center';
                 ctx.shadowBlur = 10;
                 ctx.shadowColor = '#00f2ff';
                 
                 // Top label
                 ctx.fillText(`${f}Hz`, x + barWidth/2, height - barHeight - 15);
                 
                 // Vertical guide line
                 ctx.strokeStyle = 'rgba(0, 242, 255, 0.6)';
                 ctx.setLineDash([4, 4]);
                 ctx.lineWidth = 1.5;
                 ctx.beginPath();
                 ctx.moveTo(x + barWidth/2, 0);
                 ctx.lineTo(x + barWidth/2, height - barHeight - 25);
                 ctx.stroke();
                 ctx.restore();
              }
            });
          }
          
          x += barWidth + 0.5;
        }
      } else {
        // Waveform/Solid Time Domain Mode
        analyser.getByteTimeDomainData(dataArray);
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // Create Gradient for Waveform - Advanced Spectral Mapping
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        if (colorScheme === 'vibrant') {
          // Full Spectrum Rainbow
          gradient.addColorStop(0, '#FF0000'); // Red
          gradient.addColorStop(0.2, '#FFFF00'); // Yellow
          gradient.addColorStop(0.4, '#00FF00'); // Green
          gradient.addColorStop(0.6, '#00FFFF'); // Cyan
          gradient.addColorStop(0.8, '#0000FF'); // Blue
          gradient.addColorStop(1, '#FF00FF');   // Magenta
          ctx.strokeStyle = gradient;
          ctx.shadowBlur = 12;
          ctx.shadowColor = 'rgba(0, 242, 255, 0.6)';
        } else if (colorScheme === 'fire') {
          gradient.addColorStop(0, '#FF0000'); // Red
          gradient.addColorStop(0.5, '#FF9500'); // Orange
          gradient.addColorStop(1, '#FFFF00'); // Yellow
          ctx.strokeStyle = gradient;
          ctx.shadowBlur = 20;
          ctx.shadowColor = 'rgba(255, 59, 48, 0.6)';
        } else {
          // Stealth Cyan Pro
          ctx.strokeStyle = '#00f2ff';
          ctx.shadowBlur = 10;
          ctx.shadowColor = 'rgba(0, 242, 255, 0.8)';
        }

        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let xPos = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) ctx.moveTo(xPos, y);
          else ctx.lineTo(xPos, y);

          xPos += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Add a subtle glow/fill under the wave for "Expanded" view
        if (isExpanded) {
           ctx.lineTo(width, height);
           ctx.lineTo(0, height);
           ctx.closePath();
           const fillGradient = ctx.createLinearGradient(0, height/2, 0, height);
           if (colorScheme === 'vibrant') fillGradient.addColorStop(0, 'rgba(0, 242, 255, 0.1)');
           else if (colorScheme === 'fire') fillGradient.addColorStop(0, 'rgba(255, 59, 48, 0.1)');
           else fillGradient.addColorStop(0, 'rgba(0, 242, 255, 0.05)');
           fillGradient.addColorStop(1, 'transparent');
           ctx.fillStyle = fillGradient;
           ctx.fill();
        }
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isActive, mode, colorScheme, sensitivity, onStatsUpdate, isExpanded]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${isExpanded ? 'h-full' : 'h-64'} rounded-xl bg-zinc-950/50 border border-white/5 transition-all duration-500`}
      width={isExpanded ? 1600 : 800}
      height={isExpanded ? 600 : 300}
      id="frequency-visualizer"
    />
  );
}
