import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Volume2, 
  VolumeX, 
  Settings, 
  Zap, 
  Maximize2, 
  Mic,
  Music,
  Monitor,
  Smartphone,
  ChevronRight,
  Database,
  Cpu,
  Terminal,
  Trophy,
  Waves,
  CloudRain,
  Activity,
  Menu,
  Globe,
  Check,
  X,
  Play,
  Pause,
  RotateCcw,
  Square,
  SkipForward,
  SkipBack,
  HelpCircle,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CORE_FREQUENCIES } from './lib/frequencyCore';
import AudioVisualizer from './components/AudioVisualizer';

// Audio Context Manager
class AudioController {
  context: AudioContext | null = null;
  gainNode: GainNode | null = null;
  gainMixer: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  eqNodes: BiquadFilterNode[] = [];
  compressor: DynamicsCompressorNode | null = null;
  panner: StereoPannerNode | null = null;
  harmonicFilters: BiquadFilterNode[] = [];
  source: MediaStreamAudioSourceNode | null = null;
  fileSource: AudioBufferSourceNode | null = null;
  pitchNode: AudioWorkletNode | null = null;
  audioBuffer: AudioBuffer | null = null;
  startTime: number = 0;
  pausedAt: number = 0;
  isPlaying: boolean = false;
  playbackRate: number = 1.0;
  isLooping: boolean = true;
  recorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];
  zenNodes: { noise?: AudioNode; filter?: BiquadFilterNode; lfo?: OscillatorNode; droneNodes?: OscillatorNode[] } = {};
  zenTones: Map<string, { oscs: OscillatorNode[]; gain: GainNode }> = new Map();
  mixerNodes: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();

  async init() {
    if (this.context) return;
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    try {
      await this.context.audioWorklet.addModule('/pitch-shifter.js');
      this.pitchNode = new AudioWorkletNode(this.context, 'pitch-shifter-processor');
    } catch (e) {
      console.warn('Pitch shifter worklet failed to load:', e);
    }

    this.gainNode = this.context.createGain();
    
    // Dynamics Compressor (Limiter)
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-24, this.context.currentTime);
    this.compressor.knee.setValueAtTime(40, this.context.currentTime);
    this.compressor.ratio.setValueAtTime(12, this.context.currentTime);
    this.compressor.attack.setValueAtTime(0, this.context.currentTime);
    this.compressor.release.setValueAtTime(0.25, this.context.currentTime);

    // Stereo Panner
    this.panner = this.context.createStereoPanner();

    // 432Hz Harmonic Aligners
    const harmonics = [432, 864, 1296, 1728];
    for (let i = 0; i < harmonics.length; i++) {
        const filter = this.context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = harmonics[i];
        filter.Q.value = 10; // Sharp resonance
        filter.gain.value = 0;
        this.harmonicFilters.push(filter);
    }

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 32768; // High resolution for low frequency detection
    this.analyser.smoothingTimeConstant = 0.85;

    const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let lastNode: AudioNode = this.gainNode;

    for (let i = 0; i < frequencies.length; i++) {
      const node = this.context.createBiquadFilter();
      node.type = i === 0 ? 'lowshelf' : i === frequencies.length - 1 ? 'highshelf' : 'peaking';
      node.frequency.value = frequencies[i];
      node.gain.value = 0;
      this.eqNodes[i] = node;
      lastNode.connect(node);
      lastNode = node;
    }

    // Routing: 
    // Sources (Files/Mic) -> gainNode -> EQ -> Harmonics -> PitchShift -> Mixer(gainMixer)
    // Zen -> Mixer
    // Mixer -> Compressor -> Panner -> Analyser -> Out
    this.gainMixer = this.context.createGain();

    let connectionPoint: AudioNode = lastNode;
    this.harmonicFilters.forEach(f => {
        connectionPoint.connect(f);
        connectionPoint = f;
    });

    if (this.pitchNode) {
      connectionPoint.connect(this.pitchNode);
      this.pitchNode.connect(this.gainMixer);
    } else {
      connectionPoint.connect(this.gainMixer);
    }

    this.gainMixer.connect(this.compressor);
    this.compressor.connect(this.panner);
    this.panner.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  updateHarmonics(active: boolean) {
    if (this.harmonicFilters.length && this.context) {
        this.harmonicFilters.forEach(f => {
            f.gain.setTargetAtTime(active ? 6 : 0, this.context!.currentTime, 0.2);
        });
    }
  }

  async playTestTone() {
    if (!this.context) await this.init();
    if (this.context!.state === 'suspended') await this.context!.resume();
    
    const osc = this.context!.createOscillator();
    const oscGain = this.context!.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(432, this.context!.currentTime);
    oscGain.gain.setValueAtTime(0.1, this.context!.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, this.context!.currentTime + 2);
    
    osc.connect(oscGain);
    oscGain.connect(this.gainNode!);
    osc.start();
    osc.stop(this.context!.currentTime + 2);
  }

  updateCompressor(active: boolean) {
    if (this.compressor && this.context) {
      this.compressor.threshold.setTargetAtTime(active ? -24 : 0, this.context.currentTime, 0.1);
    }
  }

  updatePan(value: number) {
    if (this.panner && this.context) {
      this.panner.pan.setTargetAtTime(value, this.context.currentTime, 0.1);
    }
  }

  setPitchFactor(factor: number) {
    if (this.pitchNode && this.context) {
      const param = this.pitchNode.parameters.get('pitch');
      if (param) {
        param.setTargetAtTime(factor, this.context.currentTime, 0.1);
      }
    }
  }

  async startMic() {
    if (!this.context) await this.init();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.source) this.source.disconnect();
      this.source = this.context!.createMediaStreamSource(stream);
      this.source.connect(this.gainNode!);
      if (this.context!.state === 'suspended') {
        await this.context!.resume();
      }
      return true;
    } catch (err) {
      console.error('Mic access denied:', err);
      return false;
    }
  }

  async loadFile(file: File) {
    if (!this.context) await this.init();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);
    
    this.audioBuffer = audioBuffer;
    this.pausedAt = 0;
    this.isPlaying = false;
    
    this.playFile();
    return true;
  }

  playFile() {
    if (!this.context || !this.audioBuffer) return;
    if (this.isPlaying) return;

    if (this.fileSource) {
      try { this.fileSource.stop(); } catch(e) {}
      this.fileSource.disconnect();
    }

    this.fileSource = this.context.createBufferSource();
    this.fileSource.buffer = this.audioBuffer;
    this.fileSource.connect(this.gainNode!);
    this.fileSource.loop = this.isLooping;
    // Set dynamic rate
    this.fileSource.playbackRate.value = this.playbackRate;

    const duration = this.audioBuffer.duration;
    const offset = this.pausedAt % duration;

    // Handle standard audio completion (when non-looping)
    this.fileSource.onended = () => {
      if (this.isPlaying && !this.isLooping) {
        this.isPlaying = false;
        this.pausedAt = 0;
      }
    };

    this.fileSource.start(0, offset);
    this.startTime = this.context.currentTime;
    this.isPlaying = true;
  }

  pauseFile() {
    if (!this.context || !this.isPlaying || !this.fileSource) return;

    const elapsed = (this.context.currentTime - this.startTime) * this.playbackRate;
    this.pausedAt = this.pausedAt + elapsed;
    if (this.audioBuffer) {
      this.pausedAt = this.pausedAt % this.audioBuffer.duration;
    }

    try { this.fileSource.stop(); } catch(e) {}
    this.fileSource.disconnect();
    this.fileSource = null;
    this.isPlaying = false;
  }

  stopFile() {
    if (this.fileSource) {
      try { this.fileSource.stop(); } catch(e) {}
      this.fileSource.disconnect();
      this.fileSource = null;
    }
    this.pausedAt = 0;
    this.isPlaying = false;
  }

  getCurrentTime(): number {
    if (!this.context || !this.audioBuffer) return 0;
    if (!this.isPlaying) return this.pausedAt % this.audioBuffer.duration;
    const elapsed = (this.context.currentTime - this.startTime) * this.playbackRate;
    let computed = this.pausedAt + elapsed;
    if (this.isLooping) {
      computed = computed % this.audioBuffer.duration;
    } else {
      computed = Math.min(computed, this.audioBuffer.duration);
    }
    return computed;
  }

  getDuration(): number {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  seek(seconds: number) {
    if (!this.audioBuffer || !this.context) return;
    const newPosition = Math.max(0, Math.min(seconds, this.audioBuffer.duration));
    
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pauseFile();
    }
    this.pausedAt = newPosition;
    if (wasPlaying) {
      this.playFile();
    }
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(0.5, Math.min(rate, 2.0));
    if (this.context) {
      if (this.isPlaying && this.fileSource) {
        this.fileSource.playbackRate.setTargetAtTime(this.playbackRate, this.context.currentTime, 0.1);
        const elapsed = (this.context.currentTime - this.startTime) * this.playbackRate;
        this.pausedAt = this.pausedAt + elapsed;
        this.startTime = this.context.currentTime;
      }
    }
  }

  setLooping(loop: boolean) {
    this.isLooping = loop;
    if (this.fileSource) {
      this.fileSource.loop = loop;
    }
  }

  startRecording(quality: 'hifi' | 'web' | 'email' = 'hifi') {
    if (!this.analyser || !this.context) return;
    const dest = this.context.createMediaStreamDestination();
    this.analyser.connect(dest);
    
    this.recordedChunks = [];
    
    // Configure bitrates based on quality
    const bitrates = {
      hifi: 256000, // 256kbps
      web: 128000,  // 128kbps
      email: 32000  // 32kbps (ultra-low for email)
    };

    const options = {
      audioBitsPerSecond: bitrates[quality],
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm'
    };

    this.recorder = new MediaRecorder(dest.stream, options);
    
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };
    
    this.recorder.start();
  }

  async stopRecording(): Promise<string | null> {
    if (!this.recorder) return null;
    return new Promise((resolve) => {
      this.recorder!.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        resolve(url);
      };
      this.recorder!.stop();
    });
  }

  async startZen(type: string) {
    if (!this.context) await this.init();
    this.stopZen(); // Only stops environments and legacy drones

    const mixer = this.gainMixer!;

    if (type === 'ocean' || type === 'rain') {
      const bufferSize = 2 * this.context!.sampleRate;
      const noiseBuffer = this.context!.createBuffer(1, bufferSize, this.context!.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Brown noise integration for smoother "flow"
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Gain compensation
      }

      const noiseSource = this.context!.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const filter = this.context!.createBiquadFilter();
      const gain = this.context!.createGain();

      if (type === 'ocean') {
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        
        const lfo = this.context!.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.12; 
        const lfoGain = this.context!.createGain();
        lfoGain.gain.value = 0.35;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        gain.gain.value = 0.45;
        lfo.start();
        this.zenNodes.lfo = lfo;
      } else {
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 0.8;
        gain.gain.value = 0.25;
      }

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(mixer); // Direct to mixer
      noiseSource.start();

      this.zenNodes.noise = noiseSource;
      this.zenNodes.filter = filter;
    } else {
      // Legacy single-drone support (optional, but keep for now if needed)
      this.toggleZenTone(type, true);
    }
  }

  async toggleZenTone(id: string, active: boolean) {
    if (!this.context) await this.init();
    if (this.context!.state === 'suspended') await this.context!.resume();

    const mixer = this.gainMixer!;
    const existing = this.zenTones.get(id);

    if (active) {
      if (existing) return;

      const solfeggioMap: Record<string, number[]> = {
        '174': [174], '216': [216], '285': [285], 
        '396': [CORE_FREQUENCIES.SOLFEGGIO.UT_396], 
        '417': [CORE_FREQUENCIES.SOLFEGGIO.RE_417], 
        '432': [CORE_FREQUENCIES.ALIGNMENT_A], 
        '528': [CORE_FREQUENCIES.SOLFEGGIO.MI_528], 
        '639': [CORE_FREQUENCIES.SOLFEGGIO.FA_639], 
        '741': [CORE_FREQUENCIES.SOLFEGGIO.SOL_741], 
        '852': [CORE_FREQUENCIES.SOLFEGGIO.LA_852], 
        '963': [CORE_FREQUENCIES.SOLFEGGIO.XI_963],
        '7.83': [CORE_FREQUENCIES.SCHUMANN_RESONANCE],
        '14.3': [14.3],
        '20.8': [20.8],
        '54': [54],
        '108': [108],
        'schumann': [CORE_FREQUENCIES.SCHUMANN_RESONANCE, 14.3, 20.8, CORE_FREQUENCIES.ALIGNMENT_A],
        'drone': [54, 108, 216, CORE_FREQUENCIES.ALIGNMENT_A],
        // New Frequencies
        '20.95': [20.95], '120': [120], '240': [240], '304': [304],
        '324': [324], '760': [760], '802': [802], '965': [965],
        '1550': [1550], '6000': [6000], '10000': [10000]
      };

      const frequencies = solfeggioMap[id] || (parseFloat(id) ? [parseFloat(id)] : []);
      if (!frequencies.length) return;

      const g = this.context!.createGain();
      g.gain.setValueAtTime(0, this.context!.currentTime);
      
      const oscs = frequencies.map((freq, i) => {
        const osc = this.context!.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.context!.currentTime);
        
        let volume = 0.10;
        if (id === 'schumann' || id === 'drone') {
          volume = freq < 20 ? 0.15 : (i === 0 ? 0.08 : 0.03);
        } else if (frequencies.length > 1) {
          volume = 0.1 / frequencies.length;
        }

        const oscGain = this.context!.createGain();
        oscGain.gain.value = volume;
        osc.connect(oscGain);
        oscGain.connect(g);
        osc.start();
        return osc;
      });

      g.gain.linearRampToValueAtTime(1.0, this.context!.currentTime + 2.0);
      g.connect(mixer);

      this.zenTones.set(id, { oscs, gain: g });
    } else {
      if (!existing) return;
      existing.gain.gain.linearRampToValueAtTime(0, this.context!.currentTime + 1.0);
      setTimeout(() => {
        try {
          existing.oscs.forEach(osc => {
            osc.stop();
            osc.disconnect();
          });
          existing.gain.disconnect();
        } catch (e) {}
      }, 1100);
      this.zenTones.delete(id);
    }
  }

  stopZen() {
    if (this.zenNodes.noise) {
      try { (this.zenNodes.noise as AudioBufferSourceNode).stop(); } catch(e) {}
    }
    if (this.zenNodes.lfo) {
      try { this.zenNodes.lfo.stop(); } catch(e) {}
    }
    if (this.zenNodes.droneNodes) {
      this.zenNodes.droneNodes.forEach(osc => {
        try { osc.stop(); } catch(e) {}
      });
    }
    this.zenNodes = {};
    
    // Stop all active zen tones too? 
    this.zenTones.forEach((val, key) => {
      this.toggleZenTone(key, false);
    });
  }

  updateGain(value: number) {
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(value, this.context!.currentTime, 0.05);
    }
  }

  updateEQ(index: number, value: number) {
    if (this.eqNodes[index]) {
      this.eqNodes[index].gain.setTargetAtTime(value, this.context!.currentTime, 0.05);
    }
  }

  async toggleMixerFreq(freq: number, active: boolean) {
    if (!this.context) await this.init();
    if (this.context!.state === 'suspended') await this.context!.resume();

    const existing = this.mixerNodes.get(freq);

    if (active) {
      if (existing) return;

      const osc = this.context!.createOscillator();
      const gain = this.context!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.context!.currentTime);
      
      gain.gain.setValueAtTime(0, this.context!.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, this.context!.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.gainMixer!);
      osc.start();

      this.mixerNodes.set(freq, { osc, gain });
    } else {
      if (!existing) return;

      existing.gain.gain.linearRampToValueAtTime(0, this.context!.currentTime + 0.1);
      setTimeout(() => {
        try {
          existing.osc.stop();
          existing.osc.disconnect();
          existing.gain.disconnect();
        } catch (e) {}
      }, 150);
      this.mixerNodes.delete(freq);
    }
  }
}

interface VolumeProfile {
  name: string;
  media: number;
  ringer: number;
  alarm: number;
}

const DEFAULT_PROFILES: VolumeProfile[] = [
  { name: 'WORK', media: 1.0, ringer: 0.5, alarm: 0.8 },
  { name: 'HOME', media: 1.5, ringer: 1.0, alarm: 1.0 },
  { name: 'DRIVING', media: 2.0, ringer: 2.0, alarm: 2.0 },
];

const PRESETS: Record<string, number[]> = {
  "FLAT": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "ROCK": [5, 4, 3, -1, -3, -2, 1, 3, 4, 5],
  "POP": [-2, -1, 0, 2, 3, 2, 0, -1, -2, -2],
  "CLASSICAL": [4, 3, 2, 1, -1, -1, 0, 1, 2, 3],
  "DANCE": [6, 5, 1, 0, 0, -1, -3, -2, 1, 2],
  "TECHNO": [5, 4, 0, -2, -2, 0, 4, 5, 5, 4],
  "BASS_BOOST": [9, 7, 5, 2, 0, 0, 0, 0, 0, 0]
};

const audio = new AudioController();

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [volume, setVolume] = useState(1);
  const [pan, setPan] = useState(0);
  const [eq, setEq] = useState(new Array(10).fill(0));
  const [currentPreset, setCurrentPreset] = useState("FLAT");
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<VolumeProfile[]>(DEFAULT_PROFILES);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<VolumeProfile | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDspKnowledgeBase, setShowDspKnowledgeBase] = useState(false);
  const [showFullscreenViz, setShowFullscreenViz] = useState(false);
  const [purityLockEnabled, setPurityLockEnabled] = useState(true);
  const [frequencyStats, setFrequencyStats] = useState<{
    peakFreq: number;
    rawFreq: number;
    note: string;
    rms: number;
    bands: { label: string; value: number }[];
    isLocked?: boolean;
    multiPeaks?: number[];
  } | null>(null);
  const [language, setLanguage] = useState<'en' | 'la' | 'fr' | 'de' | 'ru' | 'pl'>('en');
  const [activeZenTones, setActiveZenTones] = useState<Set<string>>(new Set());
  const [recordingHistory, setRecordingHistory] = useState<{ id: string; filename: string; description: string; timestamp: string }[]>([]);
  const [recordingCounter, setRecordingCounter] = useState(1);

  const ZEN_FREQUENCIES = [
    { freq: '7.83', label: 'Schumann Grounding' },
    { freq: '14.3', label: 'Schumann Harmonic' },
    { freq: '20.8', label: 'Schumann Harmonic' },
    { freq: '20.95', label: 'Deep Resonance' },
    { freq: '54', label: 'Drone Foundation' },
    { freq: '108', label: 'Sacred Overtones' },
    { freq: '120', label: 'Fatigue Relief' },
    { freq: '174', label: 'Removes Pain' },
    { freq: '216', label: 'Sacred Alignment' },
    { freq: '240', label: 'Muscle Relaxation' },
    { freq: '285', label: 'Energy Field' },
    { freq: '304', label: 'Misc Wellness' },
    { freq: '324', label: 'Muscle Pain Relief' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.UT_396.toString(), label: 'Fear & Guilt' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.RE_417.toString(), label: 'Change' },
    { freq: CORE_FREQUENCIES.ALIGNMENT_A.toString(), label: 'Miracle Nature' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.MI_528.toString(), label: 'Repair DNA' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.FA_639.toString(), label: 'Relationships' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.SOL_741.toString(), label: 'Intuition' },
    { freq: '760', label: 'Misc Balancing' },
    { freq: '802', label: 'Cell Regen' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.LA_852.toString(), label: 'Soul Tribe' },
    { freq: '965', label: 'Sinus Relief' },
    { freq: CORE_FREQUENCIES.SOLFEGGIO.XI_963.toString(), label: 'Light & Spirit' },
    { freq: '1550', label: 'Deep Relaxation' },
    { freq: '6000', label: 'Tinnitus Mask' },
    { freq: '10000', label: 'Tinnitus Relief' }
  ];

  const translations = {
    en: {
      settings: "Settings",
      language: "Interface Language",
      howToUse: "Quick Guide",
      mobileDocs: "Capacitor Mobile Framework",
      close: "Terminate Session",
      operationalGuide: "Quick Guide // Master Protocol",
      ongoingMeditation: "Ongoing Meditation Capture",
      confirmOperational: "Confirm Operational Status",
      bridgeReady: "BRIDGE_READY",
      betaPhase: "STABLE_ACTIVE",
      status: "STATUS",
      langSelect: "Language",
      zenModulator: "Zen Modulator",
      environments: "Environments",
      solfeggio: "Solfeggio Frequencies",
      sessionTimer: "Session Timer",
      aligning: "Aligning environment back to ",
      resonance: " Resonance...",
      spectrum: "Spectrum Analysis",
      frequencyData: "REALTIME_STREAM",
      expandViz: "Expand View",
      minimizeViz: "Minimize View",
      peakFreq: "Peak Frequency",
      note: "Musical Note",
      rmsLevel: "Power Level",
      bandPower: "Band Distribution",
      manualIntro: "Consentus represents a paradigm shift in meditative audio. Layer multiple distinct frequency sources simultaneously:",
      manualLayering: "Multi-Source Layering",
      manualMp3: "MP3 Source",
      manualMp3Desc: "Load music or guided tracks via File Transport.",
      manualZen: "Zen Modulator",
      manualZenDesc: "Layer Schumann, Solfeggio, or Nature sounds.",
      manual432: "432Hz Alignment",
      manual432Desc: "CRITICAL: Ensure the 432Hz module is ACTIVE for optimal resonance.",
      manualSpec: "Spectrum Insights",
      manualSpecDesc: "Track Peak Frequency, notes, and energy distribution across 7 bands.",
      manualMastering: "Mastering & Capture",
      manualMasteringDesc: "Use 'Start Capture' to record the LIVE output with all active processing.",
      manualProTip: "Layer Ocean with 963Hz and your track. Keep '432Hz' active."
    },
    la: {
      settings: "Configuratio",
      language: "Lingua Interfaciei",
      howToUse: "Manuale Breve",
      mobileDocs: "Capacitor Mobile Framework",
      close: "Sessio Terminanda",
      operationalGuide: "Manuale Breve // Regula Magistra",
      ongoingMeditation: "Captatio Meditationis Continua",
      confirmOperational: "Confirmare Status",
      bridgeReady: "PONS_PARATUS",
      betaPhase: "STABILIS_ACTIVA",
      status: "STATUS",
      langSelect: "Lingua",
      zenModulator: "Modulator Zen",
      environments: "Ecosystemata",
      solfeggio: "Frequentiae Solfeggio",
      sessionTimer: "Temporis Mensura",
      aligning: "Ordinat mundum ad ",
      resonance: " Resonantiam...",
      spectrum: "Analysis Spectri",
      frequencyData: "FLUXUS_REALIS",
      expandViz: "Expandere Visum",
      minimizeViz: "Minuere Visum",
      peakFreq: "Frequentia Maxima",
      note: "Nota Musica",
      rmsLevel: "Gradus Potentiae",
      bandPower: "Distributio Fasciarum",
      manualIntro: "Consentus repraesentat mutationem paradigmatis in audio meditativo. Multiplices fontes frequentiarum simul superpone:",
      manualLayering: "Superpositio Fontium",
      manualMp3: "Fons MP3",
      manualMp3Desc: "Invehere musicum vel sonum per Transportum Tabulariorum.",
      manualZen: "Modulator Zen",
      manualZenDesc: "Superpone Schumann, Solfeggio, vel sonitus naturae.",
      manual432: "Alineatio 432Hz",
      manual432Desc: "CRITICUM: Fac ut modulus 432Hz sit ACTIVUS ad optimam resonantiam.",
      manualSpec: "Spectri Intelligentia",
      manualSpecDesc: "Investiga frequentiam maximam, notas et distributionem energiae per 7 fasciae.",
      manualMastering: "Magisterium & Captatio",
      manualMasteringDesc: "Utere 'Incipe Captationem' ut recorderis LIVE output cum totali processu activo.",
      manualProTip: "Superpone Oceanum cum 963Hz et cantu tuo. Custodi '432Hz' activum."
    },
    fr: {
      settings: "Paramètres",
      language: "Langue de l'Interface",
      howToUse: "Guide Rapide",
      mobileDocs: "Framework Mobile Capacitor",
      close: "Terminer la Session",
      operationalGuide: "Guide Rapide // Protocole Maître",
      ongoingMeditation: "Capture de Méditation Continue",
      confirmOperational: "Confirmer le Statut Opérationnel",
      bridgeReady: "PONT_PRÊT",
      betaPhase: "PRODUCTION_PRÊTE",
      status: "STATUT",
      langSelect: "Langue",
      zenModulator: "Modulateur Zen",
      environments: "Environnements",
      solfeggio: "Fréquences Solfeggio",
      sessionTimer: "Minuteur de Session",
      aligning: "Alignement de l'environnement sur ",
      resonance: " Résonance...",
      spectrum: "Analyse de Spectre",
      frequencyData: "FLUX_DE_FRÉQUENCE_RÉEL",
      expandViz: "Agrandir la Vue",
      minimizeViz: "Réduire la Vue",
      peakFreq: "Fréquence Crête",
      note: "Note Musicale",
      rmsLevel: "Niveau de Puissance",
      bandPower: "Distribution des Bandes",
      manualIntro: "Consentus représente un changement de paradigme dans l'audio méditatif. Superposez plusieurs sources de fréquences simultanément :",
      manualLayering: "Superposition Multi-Sources",
      manualMp3: "Source MP3",
      manualMp3Desc: "Chargez de la musique ou des pistes guidées via le Transport de Fichiers.",
      manualZen: "Modulateur Zen",
      manualZenDesc: "Superposez Schumann, Solfeggio ou des sons de la nature.",
      manual432: "Alignement 432Hz",
      manual432Desc: "CRITIQUE : Assurez-vous que le module 432Hz est ACTIF pour une résonance optimale.",
      manualSpec: "Aperçu du Spectre",
      manualSpecDesc: "Suivez la fréquence de crête, les notes et la distribution d'énergie sur 7 bandes.",
      manualMastering: "Mastering & Capture",
      manualMasteringDesc: "Utilisez 'Démarrer la Capture' pour enregistrer la sortie en DIRECT avec tout le traitement actif.",
      manualProTip: "Superposez l'Océan avec 963Hz et votre piste. Gardez '432Hz' actif."
    },
    de: {
      settings: "Einstellungen",
      language: "Schnittstellensprache",
      howToUse: "Kurzanleitung",
      mobileDocs: "Capacitor Mobile Framework",
      close: "Sitzung beenden",
      operationalGuide: "Kurzanleitung // Master-Protokoll",
      ongoingMeditation: "Laufende Meditationsaufnahme",
      confirmOperational: "Betriebsstatus bestätigen",
      bridgeReady: "BRÜCKE_BEREIT",
      betaPhase: "PRODUKTION_BEREIT",
      status: "STATUS",
      langSelect: "Sprache",
      zenModulator: "Zen-Modulator",
      environments: "Umgebungen",
      solfeggio: "Solfeggio-Frequenzen",
      sessionTimer: "Sitzungs-Timer",
      aligning: "Umgebung ausrichten auf ",
      resonance: " Resonanz...",
      spectrum: "Spektralanalyse",
      frequencyData: "ECHTZEIT_FREQUENZ_STREAM",
      expandViz: "Ansicht erweitern",
      minimizeViz: "Ansicht minimieren",
      peakFreq: "Spitzenfrequenz",
      note: "Musikalische Note",
      rmsLevel: "Leistungspegel",
      bandPower: "Bandverteilung",
      manualIntro: "Consentus stellt einen Paradigmenwechsel in der meditativen Audioqualität dar. Schichten Sie mehrere Frequenzquellen gleichzeitig:",
      manualLayering: "Multi-Source Schichtung",
      manualMp3: "MP3-Quelle",
      manualMp3Desc: "Laden Sie Musik oder geführte Tracks über den Dateitransport.",
      manualZen: "Zen-Modulator",
      manualZenDesc: "Schichten Sie Schumann-, Solfeggio- oder Naturgeräusche.",
      manual432: "432Hz Ausrichtung",
      manual432Desc: "KRITISCH: Stellen Sie sicher, dass das 432Hz-Modul für optimale Resonanz AKTIV ist.",
      manualSpec: "Spektrum-Einblicke",
      manualSpecDesc: "Verfolgen Sie Spitzenfrequenzen, Noten und Energieverteilung über 7 Bänder.",
      manualMastering: "Mastering & Aufnahme",
      manualMasteringDesc: "Verwenden Sie 'Aufnahme starten', um den LIVE-Ausgang mit allen aktiven Bearbeitungen aufzunehmen.",
      manualProTip: "Schichten Sie Ozean mit 963Hz und Ihrem Track. Halten Sie '432Hz' aktiv."
    },
    ru: {
      settings: "Настройки",
      language: "Язык интерфейса",
      howToUse: "Краткое руководство",
      mobileDocs: "Система Capacitor",
      close: "Завершить сеанс",
      operationalGuide: "Краткое руководство // Мастер-протокол",
      ongoingMeditation: "Захват медитации",
      confirmOperational: "Подтвердить статус",
      bridgeReady: "МОСТ_ГОТОВ",
      betaPhase: "СЕРВЕР_ГОТОВ",
      status: "СТАТУС",
      langSelect: "Язык",
      zenModulator: "Дзен-модулятор",
      environments: "Окружение",
      solfeggio: "Частоты Сольфеджио",
      sessionTimer: "Таймер сеанса",
      aligning: "Настройка на ",
      resonance: " Резонанс...",
      spectrum: "Спектральный анализ",
      frequencyData: "ПОТОК_ЧАСТОТ",
      expandViz: "Развернуть",
      minimizeViz: "Свернуть",
      peakFreq: "Пиковая частота",
      note: "Нота",
      rmsLevel: "Мощность",
      bandPower: "Распределение",
      manualIntro: "Consentus представляет собой сдвиг парадигмы в медитативном аудио. Накладывайте несколько источников частот одновременно:",
      manualLayering: "Многослойность источников",
      manualMp3: "Источник MP3",
      manualMp3Desc: "Загружайте музыку через файловый транспорт.",
      manualZen: "Дзен-модулятор",
      manualZenDesc: "Слои Шумана, Сольфеджио или звуков природы.",
      manual432: "Настройка 432 Гц",
      manual432Desc: "ВАЖНО: Убедитесь, что модуль 432 Гц АКТИВЕН для оптимального резонанса.",
      manualSpec: "Данные спектра",
      manualSpecDesc: "Отслеживайте пиковую частоту, ноты и распределение энергии по 7 полосам.",
      manualMastering: "Мастериング и захват",
      manualMasteringDesc: "Используйте «Начать захват» для записи живого выхода со всей обработкой.",
      manualProTip: "Слой Океана с 963 Гц и вашим треком. Держите «432 Гц» активным."
    },
    pl: {
      settings: "Ustawienia",
      language: "Język interfejsu",
      howToUse: "Szybki przewodnik",
      mobileDocs: "Framework Capacitor",
      close: "Zakończ sesję",
      operationalGuide: "Szybki przewodnik // Protokół mistrzowski",
      ongoingMeditation: "Przechwytywanie sesji",
      confirmOperational: "Potwierdź status",
      bridgeReady: "MOST_GOTOWY",
      betaPhase: "PRODUKcja_GOTOWA",
      status: "STATUS",
      langSelect: "Język",
      zenModulator: "Modulator Zen",
      environments: "Środowiska",
      solfeggio: "Częstotliwości Solfeggio",
      sessionTimer: "Licznik sesji",
      aligning: "Dostrajanie do ",
      resonance: " Rezonans...",
      spectrum: "Analiza spektrum",
      frequencyData: "STRUMIEŃ_CZĘSTOTLIWOŚCI",
      expandViz: "Rozwiń widok",
      minimizeViz: "Zminimalizuj widok",
      peakFreq: "Częstotliwość szczytowa",
      note: "Nuta",
      rmsLevel: "Poziom mocy",
      bandPower: "Rozkład pasm",
      manualIntro: "Consentus to zmiana paradygmatu w mediacyjnym audio. Nakładaj wiele źródeł częstotliwości jednocześnie:",
      manualLayering: "Nakładanie wielu źródeł",
      manualMp3: "Źródło MP3",
      manualMp3Desc: "Wczytuj muzykę lub ścieżki przez transport plików.",
      manualZen: "Modulator Zen",
      manualZenDesc: "Nakładaj dźwięki Schumanna, Solfeggio lub natury.",
      manual432: "Strojenie 432Hz",
      manual432Desc: "WAŻNE: Upewnij się, że moduł 432Hz jest AKTYWNY dla optymalnego rezonansu.",
      manualSpec: "Wgląd w spektrum",
      manualSpecDesc: "Śledź częstotliwość szczytową, nuty i rozkład energii w 7 pasmach.",
      manualMastering: "Mastering i nagrywanie",
      manualMasteringDesc: "Użyj \"Rozpocznij przechwytywanie\", aby nagrać wyjście NA ŻYWO z całą aktywną obróbką.",
      manualProTip: "Połącz Ocean z 963Hz i swoją ścieżką. Trzymaj '432Hz' aktywne."
    }
  };

  const t = translations[language];
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [captureQuality, setCaptureQuality] = useState<'hifi' | 'web' | 'email'>('web');
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [trackCurrentTime, setTrackCurrentTime] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLooping, setIsLooping] = useState(true);
  
  const [zenMode, setZenMode] = useState<string>('none');
  const [zenTimer, setZenTimer] = useState(15);
  const [zenTimeRemaining, setZenTimeRemaining] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync real-time Web Audio API duration and progress
  useEffect(() => {
    let animId: number;
    const tick = () => {
      if (selectedFileName) {
        setTrackCurrentTime(audio.getCurrentTime());
        setTrackDuration(audio.getDuration());
        setIsFilePlaying(audio.isPlaying);
      } else {
        setTrackCurrentTime(0);
        setTrackDuration(0);
        setIsFilePlaying(false);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [selectedFileName]);

  useEffect(() => {
    let interval: any;
    if (zenTimeRemaining > 0 && zenMode !== 'none') {
      interval = setInterval(() => {
        setZenTimeRemaining(prev => {
          if (prev <= 1) {
            audio.stopZen();
            setZenMode('none');
            addLog("[ZEN] Session completed. Audio disengaged.");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [zenTimeRemaining, zenMode]);

  const toggleZen = (type: any) => {
    const isEnvironment = ['ocean', 'rain', 'drone', 'schumann'].includes(type);

    if (isEnvironment) {
      if (zenMode === type) {
        audio.stopZen();
        setZenMode('none');
        setZenTimeRemaining(0);
        addLog("[ZEN] Environment stopped.");
      } else {
        audio.startZen(type);
        setZenMode(type);
        setZenTimeRemaining(zenTimer * 60);
        setIsActive(true);
        addLog(`[ZEN] Generating Environment: ${type.toUpperCase()}`);
      }
    } else {
      // Toggle tone
      const newTones = new Set(activeZenTones);
      const active = !newTones.has(type);
      if (active) {
        newTones.add(type);
        if (!isActive) setIsActive(true);
        addLog(`[ZEN] Engaged Frequency: ${type}Hz`);
      } else {
        newTones.delete(type);
        addLog(`[ZEN] Disengaged Frequency: ${type}Hz`);
      }
      
      audio.toggleZenTone(type, active);
      setActiveZenTones(newTones);

      // Disable purity lock automatically if more than one tone is active
      if (newTones.size > 1 && purityLockEnabled) {
          setPurityLockEnabled(false);
          addLog("[VISUAL] Multiple frequencies detected. Reverting to RAW spectrum for clarity.");
      } else if (newTones.size === 1 && !purityLockEnabled) {
          setPurityLockEnabled(true);
          addLog("[VISUAL] Single frequency isolated. Re-engaging Purity Lock.");
      }
    }
  };

  const handleCaptureToggle = async () => {
    if (!isRecording) {
      audio.startRecording(captureQuality);
      setIsRecording(true);
      addLog("[REC] Master Capture started.");
    } else {
      const url = await audio.stopRecording();
      if (url) {
        // Generate metadata
        const activeTonesInfo = Array.from(activeZenTones)
          .map(id => {
            const freqItem = ZEN_FREQUENCIES.find(f => f.freq === id);
            return `${id}Hz (${freqItem?.label || 'Custom'})`;
          })
          .join(' / ');
        
        const countStr = recordingCounter.toString().padStart(3, '0');
        const filename = `consentus_master_zendumpt${countStr}.webm`;
        const description = `${countStr}: ${activeTonesInfo || 'No active tones'}`;
        const timestamp = new Date().toLocaleString();

        // Update history
        const newEntry = { id: countStr, filename, description, timestamp };
        setRecordingHistory(prev => [...prev, newEntry]);
        setRecordingCounter(prev => prev + 1);

        // Auto-download the recording
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setRecordingUrl(url);
        setIsRecording(false);
        addLog(`[REC] Capture completed: ${filename}`);
      }
    }
  };

  const downloadZenLog = () => {
    const header = "CONSENTUS MASTER ZEN LOG\n=========================\n\n";
    const content = recordingHistory
      .map(entry => `File: ${entry.filename}\nDesc: ${entry.description}\nTime: ${entry.timestamp}\n-------------------------`)
      .join('\n\n');
    
    const blob = new Blob([header + content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zen.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog("[SYSTEM] Zen log exported to zen.txt");
  };

  const [vizSettings, setVizSettings] = useState<{
    mode: 'bars' | 'waveform';
    colorScheme: 'vibrant' | 'mono' | 'fire';
    sensitivity: number;
    haptics: boolean;
  }>({
    mode: 'bars',
    colorScheme: 'vibrant',
    sensitivity: 0.8,
    haptics: true
  });
  
  const [logs, setLogs] = useState<string[]>([
    "[INFO] Initializing Consentus Core...",
    "[INFO] Hooking Capacitor Bridge...",
    "[OK] Driver v4.2.0 loaded."
  ]);
  const [modules, setModules] = useState({
    spatializer: false,
    edge: false,
    upsampling: false,
    limiter: false,
    alignment432: false,
    subBlast: false
  });

  const togglePower = async () => {
    if (!isActive) {
      const success = await audio.startMic();
      if (success) {
        setIsActive(true);
        addLog("[SYSTEM] Audio engine engaged.");
      }
    } else {
      setIsActive(false);
      addLog("[SYSTEM] Audio engine suspended.");
    }
  };

  const handleFileSelect = async (e: any) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFileName(file.name);
      addLog(`[FILE] Loaded: ${file.name}`);
      const success = await audio.loadFile(file);
      if (success) {
        setIsFilePlaying(true);
        setIsActive(true);
      }
    }
  };

  const handleTogglePlayPause = () => {
    if (!selectedFileName) return;
    if (audio.isPlaying) {
      audio.pauseFile();
      setIsFilePlaying(false);
      addLog("[FILE] Playback paused.");
    } else {
      audio.playFile();
      setIsFilePlaying(true);
      setIsActive(true);
      addLog("[FILE] Playback resumed.");
    }
  };

  const handleStopFile = () => {
    audio.stopFile();
    setIsFilePlaying(false);
    setTrackCurrentTime(0);
    addLog("[FILE] Playback stopped.");
  };

  const handleSeekBackward = () => {
    const current = audio.getCurrentTime();
    audio.seek(current - 10);
  };

  const handleSeekForward = () => {
    const current = audio.getCurrentTime();
    audio.seek(current + 10);
  };

  const handleScrubChange = (e: any) => {
    const targetSeconds = parseFloat(e.target.value);
    audio.seek(targetSeconds);
    setTrackCurrentTime(targetSeconds);
  };

  const handleLoopToggle = () => {
    const targetLoop = !isLooping;
    setIsLooping(targetLoop);
    audio.setLooping(targetLoop);
    addLog(`[FILE] Loop ${targetLoop ? "enabled" : "disabled"}`);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    audio.setPlaybackRate(rate);
    addLog(`[FILE] Speed adjusted to ${rate.toFixed(1)}x`);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      audio.startRecording(captureQuality);
      setIsRecording(true);
      setRecordingUrl(null);
      addLog(`[RECORDER] Capture initiated: ${captureQuality.toUpperCase()} mode.`);
    } else {
      const url = await audio.stopRecording();
      setIsRecording(false);
      setRecordingUrl(url);
      addLog("[RECORDER] Master output captured and saved.");
    }
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-4), msg]);
  };

  const applyPreset = (presetName: string) => {
    const values = PRESETS[presetName];
    if (values) {
      setEq(values);
      setCurrentPreset(presetName);
      addLog(`[DSP] Preset applied: ${presetName}`);
      if (isActive) {
        values.forEach((val, i) => audio.updateEQ(i, val));
      }
    }
  };

  const applyProfile = (profile: VolumeProfile) => {
    setActiveProfile(profile.name);
    setVolume(profile.media);
    addLog(`[PROFILE] Engaged: ${profile.name}`);
  };

  const saveProfile = (profile: VolumeProfile) => {
    setProfiles(prev => {
      const exists = prev.findIndex(p => p.name === profile.name);
      if (exists >= 0) {
        const next = [...prev];
        next[exists] = profile;
        return next;
      }
      return [...prev, profile];
    });
    setEditingProfile(null);
    setShowProfileEditor(false);
    addLog(`[PROFILE] Saved: ${profile.name}`);
  };

  useEffect(() => {
    if (isActive) {
      audio.updateGain(volume);
      // Haptic threshold check
      if (vizSettings.haptics && volume > 1.5 && navigator.vibrate) {
        navigator.vibrate(5);
      }
    }
  }, [volume, isActive, vizSettings.haptics]);

  useEffect(() => {
    if (isActive) {
      audio.updatePan(pan);
    }
  }, [pan, isActive]);

  useEffect(() => {
    if (isActive) {
      audio.updateCompressor(modules.limiter);
      audio.updateHarmonics(modules.alignment432);
      audio.setPitchFactor(modules.alignment432 ? CORE_FREQUENCIES.PITCH_RATIO_432HZ : 1.0);
    }
  }, [modules.limiter, modules.alignment432, isActive]);

  const handleEqChange = (index: number, value: number) => {
    const newEq = [...eq];
    newEq[index] = value;
    setEq(newEq);
    setCurrentPreset("CUSTOM");
    if (isActive) {
      audio.updateEQ(index, value);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col p-4 bg-[#0A0B0D] text-[#E0E2E6] font-sans selection:bg-[#A35D34]/30">
      {/* Header */}
      <header className="flex justify-between items-center border-b border-[#2D2F36] pb-4 mb-4">
        <div className="flex items-center gap-3">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="w-10 h-10 bg-[#A35D34] rounded flex items-center justify-center shadow-[0_0_20px_rgba(163,93,52,0.4)]"
          >
            <Waves className="w-6 h-6 text-white" />
          </motion.div>
          <div>
            <h1 className="text-[#A35D34]/95 font-black text-xl tracking-tighter uppercase flex items-center">
              CONSENTUS <span className="text-[#A35D34] text-[10px] font-mono border border-[#A35D34] px-1.5 py-0.5 ml-2">X-LUCIS v2.0</span>
            </h1>
            <p className="text-[9px] text-[#8E9299] font-mono tracking-widest uppercase">Audio Engineering Suite</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-8">
              <button 
                className="flex flex-col items-end cursor-pointer group transition-colors hover:bg-white/[0.02] p-1 px-2 rounded -mr-2 text-right border-none bg-transparent"
                onClick={() => setShowFullscreenViz(true)}
                title={t.expandViz}
              >
                <div className="flex items-center gap-1.5 pointer-events-none">
                   <span className="text-[9px] text-[#8E9299] uppercase font-bold tracking-widest leading-none">
                     {activeZenTones.size > 1 ? 'Multi-Spectrum' : t.peakFreq}
                   </span>
                   {frequencyStats?.isLocked && (
                     <div 
                       className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px] transition-all ${purityLockEnabled ? 'bg-[#00FF41] shadow-[#00FF41]' : 'bg-[#A35D34] shadow-[#A35D34]'}`}
                     />
                   )}
                   <Activity className="w-2.5 h-2.5 text-blue-400 opacity-20 group-hover:opacity-100 transition-all group-hover:animate-pulse" />
                </div>
                <span className={`text-[10px] font-mono pointer-events-none ${frequencyStats && frequencyStats.peakFreq > 0 ? (frequencyStats.isLocked && purityLockEnabled && activeZenTones.size <= 1 ? 'text-[#00FF41]' : 'text-blue-400') : 'text-zinc-600'}`}>
                  {activeZenTones.size > 1 
                    ? `TRACE: ${frequencyStats?.peakFreq.toFixed(3)}` 
                    : (frequencyStats ? (purityLockEnabled && frequencyStats.isLocked ? (frequencyStats.peakFreq || 0).toFixed(2) : (frequencyStats.rawFreq || 0).toFixed(3)) : '0.000')} {activeZenTones.size <= 1 && 'Hz'}
                </span>
              </button>
              {frequencyStats?.isLocked && (
                <button 
                  onClick={() => setPurityLockEnabled(!purityLockEnabled)}
                  className={`p-1 rounded bg-[#2D2F36] border border-zinc-700 hover:border-zinc-500 transition-all ${purityLockEnabled ? 'text-[#00FF41]' : 'text-[#A35D34]'}`}
                  title={purityLockEnabled ? "Showing Locked (Click for Raw)" : "Showing Raw (Click for Locked)"}
                >
                  <Activity className="w-3 h-3" />
                </button>
              )}
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-[#8E9299] uppercase font-bold tracking-widest">{t.langSelect}</span>
              <span className="text-[10px] text-[#00FF41] font-mono flex items-center gap-1.5 uppercase">
                <span className="w-1.5 h-1.5 bg-[#00FF41] rounded-full animate-pulse shadow-[0_0_5px_#00FF41]"></span> 
                {language}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-[#8E9299] uppercase font-bold tracking-widest">{t.status}</span>
              <span className="text-[10px] text-blue-400 font-mono">{t.betaPhase || t.serverStatus}</span>
            </div>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-[#2D2F36] rounded-lg transition-all text-zinc-400 hover:text-white border border-transparent hover:border-[#2D2F36] relative"
          >
            <Menu className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-sm bg-[#1A1B1E] border border-blue-500/30 rounded shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-[#2D2F36] flex items-center justify-between bg-blue-600/5">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-400" />
                  <h2 className="text-[10px] font-bold text-white uppercase tracking-[0.2em]">{t.settings}</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Globe className="w-3 h-3 text-blue-400" />
                    {t.language}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['en', 'la', 'fr', 'de', 'ru', 'pl'] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setLanguage(lang)}
                        className={`py-2 rounded border text-[9px] font-bold uppercase transition-all ${
                          language === lang 
                            ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]' 
                            : 'bg-black/40 border-[#2D2F36] text-zinc-500 hover:border-zinc-700'
                        }`}
                      >
                        {lang === 'en' ? 'English' : 
                         lang === 'la' ? 'Latina' :
                         lang === 'fr' ? 'Français' :
                         lang === 'de' ? 'Deutsch' :
                         lang === 'ru' ? 'Русский' : 'Polski'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-[#2D2F36]">
                  <button 
                    onClick={() => {
                      setShowHelp(true);
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-between p-3 rounded bg-black/40 border border-[#2D2F36] hover:border-blue-500/50 group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Terminal className="w-4 h-4 text-blue-500" />
                      <span className="text-[10px] font-bold text-zinc-400 group-hover:text-white uppercase">{t.howToUse}</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-blue-500" />
                  </button>

                  <button 
                    onClick={() => {
                      setShowDspKnowledgeBase(true);
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-between p-3 rounded bg-[#102025]/30 border border-cyan-500/25 hover:border-cyan-550/60 hover:bg-[#102025]/50 group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <HelpCircle className="w-4 h-4 text-cyan-400 animate-pulse" />
                      <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white uppercase">DSP Knowledge Base</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-cyan-400" />
                  </button>

                  <a 
                    href="/FEATURES.md" 
                    download="FEATURES.md"
                    onClick={() => {
                      addLog("[SYSTEM] Downloaded system features manifesto.");
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-between p-3 rounded bg-[#5A2D1A]/10 border border-[#A35D34]/35 hover:border-[#A35D34]/70 hover:bg-[#5A2D1A]/20 group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-[#A35D34]" />
                      <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white uppercase">App Features Catalog (.md)</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-[#A35D34]" />
                  </a>

                  <a 
                    href="https://capacitorjs.com/docs/getting-started" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-between p-3 rounded bg-black/40 border border-[#2D2F36] hover:border-blue-500/50 group transition-all"
                    onClick={() => setShowSettings(false)}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="w-4 h-4 text-blue-500" />
                      <span className="text-[10px] font-bold text-zinc-400 group-hover:text-white uppercase">{t.mobileDocs}</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-blue-500" />
                  </a>
                </div>

                <div className="pt-6 border-t border-[#2D2F36] space-y-4">
                  <div className="flex items-center gap-2 text-[#8E9299]">
                    <Database className="w-3 h-3 text-blue-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest">Master Protocol Log</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {recordingHistory.length > 0 ? (
                      <button 
                        onClick={downloadZenLog}
                        className="w-full py-2 bg-blue-600/10 border border-blue-500/30 rounded text-[10px] font-bold text-blue-400 uppercase tracking-widest hover:bg-blue-600/20 transition-all flex items-center justify-center gap-2"
                      >
                        <Database className="w-3.5 h-3.5" />
                        Download zen.txt ({recordingHistory.length} Sessions)
                      </button>
                    ) : (
                      <div className="text-[9px] text-zinc-600 italic px-2">No recording history detected in current session.</div>
                    )}
                    <p className="text-[8px] text-zinc-500 px-2 leading-relaxed">
                      Captured .webm files are stored in your browser's default <strong>Downloads</strong> folder. Use this log to track which frequencies were mixed in each dump (001, 002, etc).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Project Lead</span>
                      <span className="text-[9px] text-zinc-400 font-mono">Dragonheart // visiolucis2025@gmail.com</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">AI Engineering</span>
                      <span className="text-[9px] text-zinc-400 font-mono">Google AI Studio Coding Agent</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#141518] border-t border-[#2D2F36]">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-zinc-800 text-zinc-400 text-[9px] font-bold uppercase rounded hover:bg-zinc-700 hover:text-white transition-all tracking-widest"
                >
                  {t.status}: DISCONNECTED_UI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Visualizer Overlay */}
      <AnimatePresence>
        {showFullscreenViz && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-xl flex flex-col p-6 lg:p-12"
          >
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#A35D34] rounded flex items-center justify-center">
                  <Waves className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold uppercase tracking-[0.4em]">{t.spectrum}</h2>
                  <p className="text-[10px] font-mono text-zinc-500 tracking-widest">{t.frequencyData}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowFullscreenViz(false)}
                className="p-3 bg-zinc-800 hover:bg-[#A35D34]/20 text-zinc-400 hover:text-[#A35D34] rounded-full transition-all border border-zinc-700"
              >
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="flex-1 min-h-0 relative bg-black/40 border border-white/5 rounded-2xl overflow-hidden shadow-inner flex flex-col lg:flex-row">
                <div className="flex-1 relative pt-32 p-6 bg-zinc-950/20 shadow-inner">
                  <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start pointer-events-none z-10">
                    <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-widest block opacity-60">Engine Trace</span>
                  </div>
                  <AudioVisualizer 
                   analyser={audio.analyser} 
                   isActive={isActive} 
                   mode={vizSettings.mode}
                   colorScheme={vizSettings.colorScheme}
                   sensitivity={vizSettings.sensitivity}
                   highlightedBand={activeBand}
                   isExpanded={true}
                   onStatsUpdate={setFrequencyStats}
                   activeFrequencies={[
                     ...Array.from(activeZenTones),
                     ...(zenMode === 'schumann' ? ['7.83', '14.3', '20.8', '432'] : []),
                     ...(zenMode === 'drone' ? ['54', '108', '216', '432'] : []),
                     ...(parseFloat(zenMode) ? [zenMode] : [])
                   ]}
                 />
                 
                 {/* Overlay Info */}
                 <div className="absolute top-4 right-6 flex gap-6 text-[10px] font-mono text-white/40 uppercase pointer-events-none">
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] text-zinc-600">Sample Rate</span>
                      <span>{audio.context?.sampleRate || '...' } HZ</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] text-zinc-600">FFT Resolution</span>
                      <span>{audio.analyser?.fftSize || '...' } BINS</span>
                    </div>
                 </div>
               </div>

               {/* New Stats Side Panel */}
               <div className="w-full lg:w-96 bg-black/60 border-l border-white/5 p-6 space-y-10 overflow-y-auto">
                 <div className="space-y-6">
                   <div className="flex items-center justify-between">
                     <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        {t.peakFreq}
                     </h3>
                     <div className="flex items-center gap-2">
                       {activeZenTones.size <= 1 ? (
                         <button 
                           onClick={() => setPurityLockEnabled(!purityLockEnabled)}
                           className={`flex items-center gap-1.5 text-[8px] font-mono px-2 py-1 rounded-full border transition-all ${
                             frequencyStats?.isLocked && purityLockEnabled 
                               ? 'text-[#00FF41] bg-[#00FF41]/10 border-[#00FF41]/30 animate-pulse' 
                               : 'text-[#A35D34] bg-[#A35D34]/10 border-[#A35D34]/30'
                           }`}
                         >
                           {frequencyStats?.isLocked && purityLockEnabled ? <Check className="w-2.5 h-2.5" /> : <Activity className="w-2.5 h-2.5" />}
                           {frequencyStats?.isLocked && purityLockEnabled ? 'LOCK: ACTIVE' : (frequencyStats?.isLocked ? 'LOCK: READY' : 'LOCK: SEARCHING')}
                         </button>
                       ) : (
                         <div className="flex items-center gap-1.5 text-[8px] font-mono px-2 py-1 rounded-full border border-blue-500/30 text-blue-400 bg-blue-500/10">
                           <Activity className="w-2.5 h-2.5" />
                           MULTI-SOURCE RAW
                         </div>
                       )}
                     </div>
                   </div>
                   
                    <div className="bg-zinc-900/50 rounded-xl p-5 border border-zinc-800 shadow-xl">
                     <div className="flex justify-between items-start mb-1">
                        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">
                          {activeZenTones.size > 1 
                            ? 'Engine Trace' 
                            : (purityLockEnabled && frequencyStats?.isLocked ? 'Aligned Result' : 'Raw Measurement')}
                        </span>
                        {frequencyStats?.isLocked && (
                          <div className="flex items-center gap-1">
                            <div className={`w-1 h-1 rounded-full ${purityLockEnabled ? 'bg-[#00FF41]' : 'bg-[#A35D34]'}`} />
                            <span className="text-[7px] text-zinc-500 font-mono">{purityLockEnabled ? 'SNAPPED' : 'DRIFT'}</span>
                          </div>
                        )}
                     </div>
                     <div className={`text-4xl font-mono tracking-tighter transition-colors ${(purityLockEnabled && activeZenTones.size <= 1) && frequencyStats?.isLocked ? 'text-[#00FF41]' : 'text-blue-400'}`}>
                        {(() => {
                          if (activeZenTones.size > 1) {
                            return (frequencyStats?.peakFreq || 0).toFixed(3);
                          }
                          const isLockedAndEnabled = purityLockEnabled && frequencyStats?.isLocked;
                          const val = isLockedAndEnabled ? (frequencyStats?.peakFreq || 0) : (frequencyStats?.rawFreq || frequencyStats?.peakFreq || 0);
                          return val.toFixed(isLockedAndEnabled ? 2 : 3);
                        })()}<span className="text-sm ml-1 text-zinc-600">HZ</span>
                     </div>
                     <div className="mt-4 flex items-center justify-between border-t border-zinc-800/50 pt-3">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">{t.note}</span>
                        <span className="text-xl font-mono text-white">{frequencyStats?.note || '--'}</span>
                     </div>
                   </div>

                   {/* Harmonic Activity (Multi-Peaks) */}
                   <div className="space-y-3">
                     <div className="flex items-center justify-between">
                       <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                         <Activity className="w-3 h-3 text-cyan-400" />
                         Signal Spectral Peaks
                       </h3>
                       <span className="text-[8px] font-mono text-zinc-600">ANALYSIS: 32K FFT</span>
                     </div>
                     <div className="grid grid-cols-3 gap-2">
                       {Array.from({ length: Math.max(12, frequencyStats?.multiPeaks?.length || 0) }).map((_, i) => {
                         const p = frequencyStats?.multiPeaks?.[i];
                         const isActive = p !== undefined && Array.from(activeZenTones).some((f: any) => Math.abs(parseFloat(f) - p) < 0.6);
                         
                         return (
                           <div key={i} className={`h-9 border rounded px-2 flex justify-between items-center transition-all duration-300 ${isActive ? 'bg-cyan-500/15 border-cyan-400' : 'bg-zinc-900/40 border-zinc-800'}`}>
                              <span className={`text-[10px] font-mono leading-none ${p === undefined ? 'text-zinc-800' : isActive ? 'text-cyan-400 font-bold' : 'text-zinc-400'}`}>
                                {p !== undefined ? p.toFixed(3) : '---'}
                              </span>
                              {p !== undefined && (
                                <span className={`text-[8px] font-bold leading-none ${isActive ? 'text-cyan-400' : 'text-zinc-600'}`}>HZ</span>
                              )}
                           </div>
                         );
                       })}
                     </div>
                     <p className="text-[8px] text-zinc-600 leading-relaxed italic border-l border-zinc-800 pl-2">
                       Live spectral decomposition identifying discrete carrier waves and resonant harmonics.
                     </p>
                   </div>
                 </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t.rmsLevel}</h3>
                      <span className="text-[10px] font-mono text-blue-400">{Math.round(Math.min(100, (frequencyStats?.rms || 0) * 150))}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                       <motion.div 
                         className="h-full bg-gradient-to-r from-blue-600 to-cyan-400"
                         animate={{ width: `${Math.min(100, (frequencyStats?.rms || 0) * 150)}%` }}
                         transition={{ duration: 0.1 }}
                       />
                    </div>
                  </div>

                 <div className="space-y-4">
                   <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t.bandPower}</h3>
                   <div className="space-y-3">
                     {frequencyStats?.bands.map(band => (
                        <div key={band.label} className="space-y-1">
                          <div className="flex justify-between text-[9px] uppercase">
                            <span className="text-zinc-400">{band.label}</span>
                            <span className="text-zinc-600 font-mono">{Math.round(band.value * 100)}%</span>
                          </div>
                          <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                             <motion.div 
                               className="h-full bg-blue-500/40"
                               animate={{ width: `${Math.min(100, band.value * 300)}%` }}
                               transition={{ duration: 0.2 }}
                             />
                          </div>
                        </div>
                     ))}
                   </div>
                 </div>
               </div>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Visualizer Logic</span>
                <div className="flex gap-2">
                  {(['bars', 'waveform'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setVizSettings(v => ({ ...v, mode: m }))}
                      className={`flex-1 py-3 text-[10px] font-bold uppercase rounded border transition-all ${
                        vizSettings.mode === m ? 'bg-[#A35D34] border-[#A35D34] text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Chromatic Map</span>
                <div className="flex gap-2">
                  {(['vibrant', 'fire', 'mono'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setVizSettings(v => ({ ...v, colorScheme: s === 'mono' ? 'stealth-pro' : s }))}
                      className={`flex-1 py-3 text-[10px] font-bold uppercase rounded border transition-all ${
                        (s === 'mono' ? 'stealth-pro' : s) === vizSettings.colorScheme ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      {s === 'vibrant' ? 'Rainbow' : s === 'fire' ? 'Lava' : 'Cyan'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="flex justify-between">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Temporal Smoothing</span>
                  <span className="text-[10px] font-mono text-white">{Math.round(vizSettings.sensitivity * 100)}%</span>
                </div>
                <input 
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.05"
                  value={vizSettings.sensitivity}
                  onChange={(e) => setVizSettings(v => ({ ...v, sensitivity: parseFloat(e.target.value) }))}
                  className="w-full accent-[#A35D34]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHelp && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-lg bg-[#1A1B1E] border border-blue-500/30 rounded shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-[#2D2F36] flex items-center justify-between bg-blue-600/5">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-blue-400" />
                  <h2 className="text-xs font-bold text-white uppercase tracking-[0.3em]">{t.operationalGuide}</h2>
                </div>
                <button onClick={() => setShowHelp(false)} className="text-zinc-500 hover:text-white transition-colors">
                  <Maximize2 className="w-4 h-4 rotate-45" />
                </button>
              </div>

              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-400">
                    <Music className="w-4 h-4" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest">{t.manualLayering}</h3>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                    {t.manualIntro}
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { t: t.manualMp3, d: t.manualMp3Desc },
                      { t: t.manualZen, d: t.manualZenDesc },
                      { t: t.manual432, d: t.manual432Desc }
                    ].map((item, i) => (
                      <div key={i} className="p-3 bg-black/40 border border-[#2D2F36] rounded transition-colors hover:border-blue-500/30">
                        <span className="text-[9px] font-bold text-blue-400 uppercase block mb-1">{item.t}</span>
                        <p className="text-[10px] text-zinc-500 leading-snug">{item.d}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00FF41]">
                    <Waves className="w-4 h-4" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest">{t.manualSpec}</h3>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {t.manualSpecDesc}
                  </p>
                </section>

                <section className="space-y-4 p-5 bg-amber-500/5 border border-amber-500/20 rounded">
                  <div className="flex items-center gap-2 text-amber-500">
                    <Database className="w-4 h-4" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest">{t.manualMastering}</h3>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {t.manualMasteringDesc}
                  </p>
                  <p className="text-[10px] text-zinc-500 leading-relaxed italic border-l-2 border-amber-500/40 pl-3">
                    {t.manualProTip}
                  </p>
                </section>

                <section className="space-y-4 p-5 bg-red-500/5 border border-red-500/20 rounded-md">
                  <div className="flex items-center gap-2 text-red-500">
                    <Activity className="w-4 h-4 animate-pulse" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest">Troubleshooting & Sound Optimization</h3>
                  </div>
                  <div className="space-y-3.5 text-[10px] text-zinc-400 leading-relaxed font-mono">
                    <div className="space-y-1 bg-black/30 p-2.5 rounded border border-red-500/10">
                      <p className="text-red-400 font-bold uppercase tracking-wide text-[9px]">// Scratchy, Flanged or Fragmented Sound?</p>
                      <p className="text-zinc-400">
                        When playing fast, dense electronic, or techno music with heavy sub-bass sidechaining and crisp transients, real-time 432Hz dynamic pitch shifting can slice audio frames to shrink or expand them. This creates phase interference (metallic, comb-filter effects) and smears rapid transients, causing audible crackles or micro-stutters.
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-cyan-400 font-bold uppercase tracking-wide text-[9px]">// Quick Resolution Guide</p>
                      <ul className="list-disc list-inside space-y-1 text-zinc-400 pl-1">
                        <li>
                          <strong className="text-zinc-300">For Electronic & Techno:</strong> Click <strong className="text-zinc-200 bg-zinc-800 px-1 rounded">BYPASS ALL DSP</strong>. Dense synthesizer arrangements and hard percussion sound best when played raw, letting standard tuned frequencies come through without phase division.
                        </li>
                        <li>
                          <strong className="text-zinc-300">For Ambient, Vocal & Solfeggio:</strong> Revalidate alignment. Click <strong className="text-cyan-400 bg-cyan-950/40 border border-cyan-500/20 px-1 rounded">OPTIMIZE ALIGNMENT</strong> to immediately restore 432Hz Core micro-pitch filters, Spatializers, and Sub blast layers.
                        </li>
                        <li>
                          <strong className="text-zinc-300">Browser Audio context:</strong> Some browsers rate-limit custom audio contexts. Reloading your audio file or toggling the master switch will reinitialize the Consentus driver loop cleanly.
                        </li>
                      </ul>
                    </div>
                  </div>
                </section>
              </div>

              <div className="p-6 bg-[#141518] border-t border-[#2D2F36]">
                <button 
                  onClick={() => setShowHelp(false)}
                  className="w-full py-4 bg-blue-600 text-white text-[10px] font-bold uppercase rounded hover:bg-blue-700 transition-all tracking-[0.2em] shadow-lg shadow-blue-900/20"
                >
                  {t.confirmOperational}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DSP Knowledge Base Overlay */}
      <AnimatePresence>
        {showDspKnowledgeBase && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/95 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-2xl bg-[#0F1115] border border-cyan-500/30 rounded shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-[#2D2F36] flex items-center justify-between bg-cyan-950/20">
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-5 h-5 text-cyan-400 animate-pulse" />
                  <div>
                    <h2 className="text-xs font-bold text-white uppercase tracking-[0.3em]">// DSP Engineering Reference Knowledge Base</h2>
                    <p className="text-[8px] text-zinc-500 font-mono tracking-widest uppercase">Protocol ID: KB-DSP-9042 // SYSTEM RESEARCH</p>
                  </div>
                </div>
                <button onClick={() => setShowDspKnowledgeBase(false)} className="text-zinc-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar font-mono text-[11px] leading-relaxed text-zinc-300">
                
                {/* Section 1 */}
                <div className="space-y-3 bg-black/40 border border-zinc-800 p-5 rounded">
                  <div className="flex items-center gap-2 text-amber-400 border-b border-zinc-800 pb-2">
                    <span className="bg-amber-400/10 text-amber-400 text-[9px] px-1.5 py-0.5 rounded font-black">STORY</span>
                    <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-200">The "Techno/Electronic" Sound Distortion</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <p className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-widest">// QUESTION:</p>
                      <p className="text-zinc-300 italic pl-3 border-l border-zinc-700">
                        "When we loaded techno music, the sound was scratchy & breaky. It didn't sound right until some DSP elements, especially A=432Hz Alignment, were disabled. Why?"
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[9.5px] font-bold text-cyan-400 uppercase tracking-widest">// THE TECHNICAL REASON:</p>
                      <p>
                        Real-time 432Hz Alignment relies on <strong className="text-zinc-100">Fourier Domain (FFT) Pitch Shifting</strong>. To lower playbacks from standard A=440Hz to A=432Hz without changing the speed, the engine slices audio into millisecond-sized overlapping frames, modifies their phase bins, and reconstructs them.
                      </p>
                      <p>
                        Techno and heavy electronic music feature ultra-dense frequency layers, heavy sidechain compression, and sharp percussive transients (like rapid hi-hats and powerful 959 kicks). 
                      </p>
                      <ul className="list-disc leading-relaxed pl-5 space-y-1.5 text-zinc-400">
                        <li>
                          <strong className="text-zinc-200">Transient Smearing:</strong> Splicing frames blurs vertical energy transients, creating crackles or micro-stutters during re-synthesis.
                        </li>
                        <li>
                          <strong className="text-zinc-200">Comb Filtering & Phase Cancellation:</strong> Shifting multi-layered synthesizers by a 0.9818 ratio overlaps their phases awkwardly, causing dramatic metallic comb filtering and phase cancellation.
                        </li>
                      </ul>
                      <p className="text-amber-400 bg-amber-400/5 p-3 rounded border border-amber-500/10">
                        <strong className="font-bold">ENGINEERING DIRECTIVE:</strong> High-energy, professionally mastered electronic music should be played bypassed (raw linear output using the <strong className="bg-[#121315] uppercase px-1.5 rounded font-bold text-zinc-300">Bypass All DSP</strong> switch). Slow ambient vocal tracks, meditation chimes, or acoustic sounds work beautifully with dynamic pitch modifiers.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Section 2 */}
                <div className="space-y-3 bg-black/40 border border-zinc-800 p-5 rounded">
                  <div className="flex items-center gap-2 text-cyan-400 border-b border-zinc-800 pb-2">
                    <span className="bg-cyan-400/10 text-cyan-400 text-[9px] px-1.5 py-0.5 rounded font-black">GRAPH</span>
                    <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-200">Zen Tones vs. Main DSP Connections</h3>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-widest">// QUESTION:</p>
                      <p className="text-zinc-300 italic pl-3 border-l border-zinc-700">
                        "When clicking the Zen Tones below, does the DSP (EQ, 432Hz Core) process those as well, or is that only for MP3s and Mic inputs?"
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[9.5px] font-bold text-cyan-400 uppercase tracking-widest">// THE SIGNAL ROUTING PROFILE:</p>
                      <p>
                        Zen Tones <strong className="text-zinc-100">completely bypass</strong> input-coloring DSP nodes like the 10-Band Graphic EQ, 432Hz Harmonic Resonator, and the Pitch Shifter. They feed directly into the Master Gain Mixer!
                      </p>
                      <div className="bg-[#0A0D10] border border-zinc-800 p-3.5 rounded font-mono text-[8.5px] text-zinc-500 leading-normal overflow-x-auto whitespace-pre">
{`   [MP3 AUDIO FILE / MIC INPUT]
                |
                v
       10-Band Graphic EQ --------> [Harmonic peak filters] --------> [Pitch-Shifter Node]
                                                                                |
                                                                                v
   [ZEN TONES / PURE DRONES] -----------------------------------------> [MASTER MIXER BUS]
                                                                                |
                                                                                v
                                                                        [Master Limiter]
                                                                                |
                                                                                v
                                                                        [Physical Output]`}
                      </div>
                      <p>
                        This design is crucial for <strong className="text-cyan-400 font-bold">Purity Safeguards</strong>:
                      </p>
                      <ul className="list-disc pl-5 space-y-1.5 text-zinc-400">
                        <li>
                          <strong className="text-zinc-200">Preserving Frequency Precision:</strong> Zen Tones are pure scientific sine mathematical wave frequencies (e.g. Solfeggios, Schumann 7.83Hz). Running them through the Pitch Shifter or graphic bands would degrade their fundamental core frequencies.
                        </li>
                        <li>
                          <strong className="text-zinc-200">Unified Cohesion:</strong> After mixing together, Zen Tones and MP3 signals pass through the <strong className="text-zinc-250">Master Compressor/Limiter</strong>, ensuring no audio clipping and providing a blended output during recordings!
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Section 3 */}
                <div className="space-y-3 bg-black/40 border border-zinc-800 p-5 rounded">
                  <div className="flex items-center gap-2 text-rose-400 border-b border-zinc-800 pb-2">
                    <span className="bg-rose-400/10 text-rose-400 text-[9px] px-1.5 py-0.5 rounded font-black">PHYSICS</span>
                    <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-200">The 7.83Hz - 174Hz Hearing threshold & speakers</h3>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-widest">// QUESTION:</p>
                      <p className="text-zinc-300 italic pl-3 border-l border-zinc-700">
                        "When clicking on 7.83 I don't hear anything, but the 'Schumann' preset produces sound. In fact, individual tones below 174Hz are barely audible, if at all. Why?"
                      </p>
                    </div>

                    <div className="space-y-4 text-zinc-400">
                      <p className="text-[9.5px] font-bold text-cyan-400 uppercase tracking-widest">// THE AUDIO PHYSICS & BIOLOGICAL FACTORS:</p>
                      <p>
                        This is a standard physical phenomenon combining Web Audio wave theory, human audiology, and hardware transducer physics:
                      </p>
                      <ul className="list-disc pl-5 space-y-3.5">
                        <li>
                          <strong className="text-zinc-200">Human Auditory Limit & Fletcher-Munson Curves (Biological Factors):</strong> 
                          The human ear is not equally sensitive to all pitches. While we hear 20Hz-20kHz, our nervous system is tuned to prioritize mid-range frequencies (where voice resides). Bass tones under 120Hz require massive acoustic energy and volume (dB SPL) to cross our neurological sensitivity threshold. Age-related internal ear changes also naturally reduce sensitivity to low rumble frequencies at normal house levels.
                        </li>
                        <li>
                          <strong className="text-rose-400">Infrasound Frequencies (&lt; 20Hz):</strong> 
                          Frequencies like Earth's Schumann Resonance (7.83Hz) and its first harmonics (14.3Hz, 20.8Hz) are entirely infrasonic. You cannot hear them as a tone; they can only be perceived as tactile pressure sensations, mechanical vibratory waves, or via specialized bone-conduction therapy devices.
                        </li>
                        <li>
                          <strong className="text-zinc-200">Room Phase Cancellation (Environmental Factors):</strong> 
                          Low frequencies have immense physical wavelengths (e.g. 50Hz has a 22-foot wavelength). When bouncing off room walls, waves overlap and cancel themselves out, creating silent spots where the bass becomes totally inaudible depending on where you stand.
                        </li>
                        <li>
                          <strong className="text-zinc-200">Acoustic Seal & Headphone Limitations (Transducer Factors):</strong> 
                          Standard device speakers (smartphones, laptops, monitors) cannot physically move enough air to vibrate low frequencies and automatically cut them off. Furthermore, if wearing earbuds or headphones, any tiny air gap in the physical cushion seal allows low-frequency pressure to escape, dropping the bass level by up to 24dB. A perfect airtight seal on premium closed-back headphones is required.
                        </li>
                        <li>
                          <strong className="text-zinc-200">The Power of Carrier Harmonics:</strong> 
                          The individual <strong className="text-zinc-250">7.83Hz</strong> button plays a single pure sub-bass, which is silent. However, the <strong className="text-teal-400 font-bold">Schumann preset</strong> stacks [7.83Hz, 14.3Hz, 20.8Hz, AND 432Hz] together. The <strong className="text-zinc-100">432Hz carrier tone</strong> acts as an audible harmonic bridge, allowing your speakers to render the energy of the full stack clearly!
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

              </div>

              <div className="p-6 bg-[#141518] border-t border-[#2D2F36] flex gap-3">
                <a 
                  href="/DSP_REFERENCE.md" 
                  download="DSP_REFERENCE.md"
                  onClick={() => addLog("[SYSTEM] Downloaded local DSP reference file.")}
                  className="flex-1 py-3 text-center bg-cyan-600/10 text-cyan-400 hover:bg-cyan-600/25 border border-cyan-500/30 rounded text-[9.5px] font-black uppercase tracking-[0.2em] transition-all"
                >
                  Download Reference Doc (.md)
                </a>
                <button 
                  onClick={() => setShowDspKnowledgeBase(false)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9.5px] font-black uppercase rounded transition-all tracking-[0.2em]"
                >
                  Return to Console
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Layout Grid */}
      <main className="flex-1 grid grid-cols-12 gap-4">
        
        {/* Left: Master Controls */}
        <section className="col-span-12 lg:col-span-4 panel p-6 flex flex-col justify-between">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">Master Output</h2>
              <span className={`status-tag ${isActive ? 'bg-[#A35D34] text-white animate-pulse' : 'bg-zinc-800 text-zinc-500'}`}>
                {isActive ? 'BLAST MODE ENABLED' : 'IDLE'}
              </span>
            </div>

            <div className="relative flex flex-col items-center justify-center py-6">
              {/* Dial Simulation */}
              <div className={`w-52 h-52 rounded-full border-8 transition-colors duration-500 flex items-center justify-center relative ${isActive ? 'border-[#A35D34]/30' : 'border-[#2D2F36]'}`}>
                <div className="absolute inset-2 rounded-full border border-dashed border-[#A35D34] opacity-10 animate-[spin_20s_linear_infinite]"></div>
                <div className="flex flex-col items-center">
                  <motion.span 
                    key={volume}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`text-6xl font-black font-mono tracking-tighter tabular-nums ${isActive ? 'text-[#A35D34]' : 'text-[#2D2F36]'}`}
                  >
                    {Math.round(volume * 100)}%
                  </motion.span>
                  <span className="text-[10px] text-[#8E9299] uppercase mt-1 font-bold tracking-widest">Gain Level</span>
                </div>
                
                {/* Visual Dial Handle */}
                <motion.div 
                  animate={{ rotate: (volume / 3) * 270 - 135 }}
                  className="absolute w-1.5 h-6 bg-[#A35D34] top-0 left-1/2 -ml-0.75 -mt-3 rounded-full shadow-[0_0_15px_#A35D34]"
                />
              </div>

              <div className="w-full max-w-xs mt-10 space-y-2">
                <input 
                  type="range"
                  min="0"
                  max="3"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] font-mono text-[#8E9299] uppercase">
                  <span>Reference (0dB)</span>
                  <span className="text-[#A35D34]">Blast Tier (+12dB)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <button 
              onClick={() => {
                setVolume(0);
                audio.playTestTone();
                addLog("[DEBUG] Test tone generated (Sine 432Hz)");
              }}
              className="w-full py-4 bg-[#212226] border border-[#2D2F36] rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-800 transition-all tracking-widest flex items-center justify-center gap-2"
            >
              <Music className="w-3 h-3" /> Test Audio
            </button>
            <button 
              onClick={togglePower}
              className={`w-full py-4 rounded-lg text-[10px] font-bold uppercase transition-all tracking-widest flex items-center justify-center gap-2 ${isActive ? 'bg-[#A35D34] text-white shadow-[0_0_20px_rgba(163,93,52,0.3)]' : 'bg-[#2D2F36] text-[#8E9299] hover:bg-[#3D3F46]'}`}
            >
              <Activity className={`w-3 h-3 ${isActive ? 'animate-pulse' : ''}`} />
              {isActive ? 'Engaged' : 'Ignite'}
            </button>
          </div>

          <div className="panel p-5 mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">File Transport</h2>
              <div className="status-tag bg-blue-500/10 text-cyan-400">PRO_DECK_v2</div>
            </div>
            
            <div className="space-y-4">
              {/* Quality Preset Selectors */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest px-1">Capture Quality Target</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['hifi', 'web', 'email'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setCaptureQuality(q)}
                      className={`py-1.5 px-2 text-[9px] font-bold uppercase rounded border transition-all ${
                        captureQuality === q ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500/50' : 'bg-black/40 text-zinc-500 border-[#2D2F36] hover:bg-zinc-800'
                      }`}
                    >
                      {q === 'hifi' ? 'Pro Res' : q === 'web' ? 'Balanced' : 'Small / Email'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload area */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-16 border border-dashed border-[#2D2F36] rounded bg-black/10 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-400/50 hover:bg-black/30 transition-all group"
              >
                <Music className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400 group-hover:scale-105 transition-all" />
                <span className="text-[8.5px] text-zinc-500 mt-1.5 uppercase font-bold tracking-wider group-hover:text-cyan-400">
                  {selectedFileName ? "Change Audio / MP3 Source" : "Load MP3 / Ambient File"}
                </span>
                <input 
                  ref={fileInputRef}
                  type="file" 
                  accept="audio/*" 
                  className="hidden" 
                  onChange={handleFileSelect}
                />
              </div>

              {/* Interactive Audio Player Deck with playback options, progress counter and scrub bars */}
              {selectedFileName && (
                <div className="bg-black/45 border border-[#2D2F36] rounded p-4 space-y-3.5 transition-all">
                  
                  {/* Title Bar & Info */}
                  <div className="flex justify-between items-center bg-[#151618] border border-[#232429] rounded px-3 py-1.5">
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      <div className="relative flex items-center justify-center h-2 w-2">
                        <span className={`absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75 ${isFilePlaying ? "animate-ping" : ""}`}></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
                      </div>
                      <span className="text-[10px] text-zinc-300 font-mono font-bold truncate max-w-[150px]" title={selectedFileName}>
                        {selectedFileName}
                      </span>
                    </div>
                    <button 
                      onClick={() => {
                        audio.stopFile();
                        setSelectedFileName(null);
                        addLog("[FILE] Halted & ejected track.");
                      }}
                      className="text-[8.5px] font-bold text-red-500 hover:text-red-400 hover:underline transition-colors ml-2 uppercase"
                    >
                      Eject
                    </button>
                  </div>

                  {/* Range Progress bar with timing tracking labels */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-mono font-bold text-zinc-500 leading-none">
                      <span className="text-cyan-400">{formatTime(trackCurrentTime)}</span>
                      <span>{formatTime(trackDuration)}</span>
                    </div>
                    
                    {/* Native dynamic scrub speed rail */}
                    <input 
                      type="range"
                      min="0"
                      max={trackDuration || 0}
                      step="0.05"
                      value={trackCurrentTime}
                      onChange={handleScrubChange}
                      className="w-full h-1.5 rounded-lg appearance-none cursor-pointer outline-none bg-zinc-900 border border-zinc-800/80 accent-cyan-400 hover:accent-cyan-300 transition-all [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_#00f2ff]"
                    />
                  </div>

                  {/* Multi-action Deck: Play / Pause, Stop, Seek Skip Buttons */}
                  <div className="flex items-center justify-between gap-1 border-t border-[#2D2F36]/40 pt-3">
                    {/* Seek Left -10s */}
                    <button 
                      onClick={handleSeekBackward}
                      title="Rewind 10 Seconds"
                      className="p-1 px-2.5 rounded bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-1"
                    >
                      <SkipBack className="w-3 h-3" />
                      <span className="text-[7px] font-black font-mono">-10</span>
                    </button>

                    {/* Integrated play pause control cluster */}
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={handleTogglePlayPause}
                        className={`px-4 py-2 text-[9px] font-bold uppercase rounded flex items-center justify-center gap-1.5 transition-all text-white ${isFilePlaying ? 'bg-amber-500/90 hover:bg-amber-450 border border-amber-400/50 text-white shadow-[0_0_12px_rgba(245,158,11,0.2)]' : 'bg-cyan-500 hover:bg-cyan-450 border border-cyan-400/50 text-black shadow-[0_0_12px_rgba(6,182,212,0.2)]'}`}
                      >
                        {isFilePlaying ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                        {isFilePlaying ? "Pause" : "Play"}
                      </button>

                      {/* Hard Stop / Clear */}
                      <button 
                        onClick={handleStopFile}
                        title="Stop & Rewind to Starting Offset"
                        className="p-1.5 px-2 rounded bg-[#A35D34]/10 hover:bg-[#A35D34]/25 border border-[#A35D34]/30 text-[#A35D34] hover:text-white transition-all flex items-center justify-center"
                      >
                        <Square className="w-3 h-3 fill-current" />
                      </button>
                    </div>

                    {/* Seek Right +10s */}
                    <button 
                      onClick={handleSeekForward}
                      title="Forward 10 Seconds"
                      className="p-1 px-2.5 rounded bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-1"
                    >
                      <span className="text-[7px] font-black font-mono">+10</span>
                      <SkipForward className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Loop Toggle, and playback rate (Speed multiplier options) */}
                  <div className="grid grid-cols-2 gap-2 border-t border-[#2D2F36]/30 pt-3">
                    {/* Loop trigger tool */}
                    <button 
                      onClick={handleLoopToggle}
                      className={`flex items-center justify-between px-2 py-1.5 rounded border uppercase text-[8px] font-black tracking-widest transition-all ${isLooping ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' : 'bg-black/30 border-[#2D2F36] text-zinc-500'}`}
                    >
                      <span className="flex items-center gap-1">
                        <RotateCcw className={`w-2.5 h-2.5 ${isLooping && isFilePlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
                        Looping
                      </span>
                      <span className="text-[7.5px] font-mono px-1 bg-zinc-900 border border-zinc-800 rounded">{isLooping ? "ON" : "OFF"}</span>
                    </button>

                    {/* Quick rate controllers */}
                    <div className="bg-[#121314] border border-[#2D2F36] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[7.5px] text-zinc-600 font-bold uppercase tracking-wider">Speed:</span>
                      <div className="flex gap-1.5">
                        {([0.8, 1.0, 1.2] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => handleSpeedChange(r)}
                            className={`p-0.5 px-1.5 text-[8.5px] font-black rounded font-mono ${playbackRate === r ? 'bg-cyan-400 text-black font-bold' : 'bg-black/55 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                          >
                            {r.toFixed(1)}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* Recorder Capture controls */}
              <div className="pt-2 border-t border-[#2D2F36]/30">
                <button 
                  onClick={toggleRecording}
                  disabled={!isActive}
                  className={`w-full py-4 text-[10px] font-black tracking-widest uppercase rounded flex items-center justify-center gap-2 transition-all ${isRecording ? 'bg-[#A35D34] text-white animate-pulse border border-[#A35D34] shadow-[0_0_15px_rgba(163,93,52,0.3)]' : 'bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 disabled:opacity-20 hover:text-white'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isRecording ? "bg-white" : "bg-[#A35D34]"}`}></span>
                  {isRecording ? 'Recording Output Master...' : 'Record Master Output'}
                </button>
              </div>

              {recordingUrl && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-blue-400 uppercase">Filtered Capture Ready</span>
                    <span className="text-[8px] text-blue-400/70 font-mono italic">consentus_master_dump.webm</span>
                  </div>
                  <a 
                    href={recordingUrl} 
                    download="consentus_master_dump.webm"
                    className="p-2 bg-blue-400 text-white rounded hover:bg-blue-500 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>
            
            <p className="text-[8px] text-zinc-650 uppercase italic tracking-wide mt-1 leading-relaxed">
              * The "Record Master Output" captures the final master output loop processed by Consentus engines (including peak-filtered alignment, custom resonant Solfeggios, and dynamic limiting compression) into clean, high-fidelity {captureQuality.toUpperCase()} WebM format.
            </p>
          </div>
        </section>

        {/* Center: Precision EQ & Visualizer */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          <div className="panel p-4 flex-none">
             <div className="flex justify-between items-center mb-4">
                <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">{t.spectrum}</h2>
                <div className="flex items-center gap-3">
                  {frequencyStats && (
                    <motion.button
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      onClick={() => setShowFullscreenViz(true)}
                      className="flex items-center gap-2 px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all group"
                    >
                      <Activity className="w-3 h-3 text-blue-400 group-hover:animate-pulse" />
                      <span className="text-[10px] font-mono text-blue-400 font-bold whitespace-nowrap">
                        {activeZenTones.size > 1 ? `DETECTION: ${activeZenTones.size} TONES` : `${(purityLockEnabled && frequencyStats.isLocked ? frequencyStats.peakFreq : frequencyStats.rawFreq || frequencyStats.peakFreq || 0).toFixed(purityLockEnabled && frequencyStats.isLocked ? 2 : 3)} Hz`}
                      </span>
                      <Maximize2 className="w-2.5 h-2.5 text-blue-400/50" />
                    </motion.button>
                  )}
                  <span className={`text-[8px] font-mono ${isActive ? 'text-[#00FF41]' : 'text-zinc-700'}`}>{t.frequencyData}</span>
                  <button 
                    onClick={() => setShowFullscreenViz(true)}
                    className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-white"
                    title={t.expandViz}
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
             </div>
             {!showFullscreenViz && (
              <AudioVisualizer 
                analyser={audio.analyser} 
                isActive={isActive} 
                mode={vizSettings.mode}
                colorScheme={vizSettings.colorScheme}
                sensitivity={vizSettings.sensitivity}
                highlightedBand={activeBand}
                isExpanded={false}
                onStatsUpdate={setFrequencyStats}
                activeFrequencies={[
                  ...Array.from(activeZenTones),
                  ...(zenMode === 'schumann' ? ['7.83', '14.3', '20.8', '432'] : []),
                  ...(zenMode === 'drone' ? ['54', '108', '216', '432'] : []),
                  ...(parseFloat(zenMode) ? [zenMode] : [])
                ]}
              />
             )}
             
             <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#2D2F36]">
                <div className="space-y-1">
                  <span className="text-[8px] font-bold text-zinc-600 uppercase">Mode</span>
                  <select 
                    value={vizSettings.mode}
                    onChange={(e) => setVizSettings(v => ({ ...v, mode: e.target.value as any }))}
                    className="w-full bg-[#212226] border border-[#2D2F36] text-[8px] font-bold uppercase text-[#8E9299] p-1 rounded"
                  >
                    <option value="bars">Bars</option>
                    <option value="waveform">Wave</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] font-bold text-zinc-600 uppercase">Scheme</span>
                  <select 
                    value={vizSettings.colorScheme}
                    onChange={(e) => setVizSettings(v => ({ ...v, colorScheme: e.target.value as any }))}
                    className="w-full bg-[#212226] border border-[#2D2F36] text-[8px] font-bold uppercase text-[#8E9299] p-1 rounded"
                  >
                    <option value="vibrant">Vibrant</option>
                    <option value="fire">Lava</option>
                    <option value="mono">Stealth</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] font-bold text-zinc-600 uppercase">Input</span>
                  <div className="flex items-center gap-2 pt-1">
                    <input 
                      type="range"
                      min="0"
                      max="0.95"
                      step="0.05"
                      value={vizSettings.sensitivity}
                      onChange={(e) => setVizSettings(v => ({ ...v, sensitivity: parseFloat(e.target.value) }))}
                      className="flex-1 accent-blue-400"
                    />
                  </div>
                </div>
                <div className="space-y-1 col-span-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold text-zinc-600 uppercase">Stereo Pan (L/R)</span>
                    <span className="text-[8px] font-mono text-zinc-500">{pan.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range"
                    min="-1"
                    max="1"
                    step="0.01"
                    value={pan}
                    onChange={(e) => setPan(parseFloat(e.target.value))}
                    className="w-full accent-blue-400"
                  />
                </div>
             </div>
          </div>

          <div className="panel p-5 min-h-[450px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div className="flex flex-col">
                <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">10-Band Precision EQ</h2>
                <span className="text-[8px] font-mono text-zinc-600 uppercase">Profile: {currentPreset}</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => applyPreset("BASS_BOOST")}
                  className="px-2 py-1 bg-[#212226] border border-[#2D2F36] text-[8px] font-bold text-[#A35D34] uppercase rounded hover:border-[#A35D34]/50"
                >
                  ⚡ Bass Boost
                </button>
                <select 
                  value={currentPreset}
                  onChange={(e) => applyPreset(e.target.value)}
                  className="bg-[#212226] border border-[#2D2F36] text-[9px] font-bold uppercase text-[#8E9299] px-2 py-1 rounded focus:outline-none"
                >
                  {Object.keys(PRESETS).map(p => <option key={p} value={p}>{p}</option>)}
                  <option value="CUSTOM" disabled>CUSTOM</option>
                </select>
                <button 
                  onClick={() => applyPreset("FLAT")}
                  className="text-[9px] font-bold text-blue-400 uppercase border-b border-blue-400/30 pb-0.5"
                >
                  Reset
                </button>
              </div>
            </div>
            
            <div className="flex-1 flex justify-between items-end gap-1 px-2 relative min-h-0">
              {/* Grid Overlay */}
              <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none opacity-5 px-6">
                {[...Array(5)].map((_, i) => <div key={i} className="border-t border-white w-full"></div>)}
              </div>
              
              {eq.map((val, i) => {
                const freqs = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
                return (
                  <div key={i} className="flex flex-col items-center gap-3 h-full group">
                    <div className="w-1.5 h-full bg-[#212226] rounded-full relative flex flex-col justify-end">
                       <motion.div 
                        animate={{ height: `${((val + 20) / 40) * 100}%` }}
                        className="w-full bg-[#2D2F36] rounded-full transition-colors group-hover:bg-[#A35D34]/30"
                       />
                       <input 
                        type="range"
                        min="-20"
                        max="20"
                        step="1"
                        value={val}
                        onChange={(e) => handleEqChange(i, parseFloat(e.target.value))}
                        onMouseDown={() => setActiveBand(i)}
                        onMouseUp={() => setActiveBand(null)}
                        onTouchStart={() => setActiveBand(i)}
                        onTouchEnd={() => setActiveBand(null)}
                        className="absolute h-full w-4 left-1/2 -ml-2 -rotate-180 opacity-0 cursor-pointer pointer-events-auto"
                        style={{ appearance: 'slider-vertical' } as any}
                       />
                       <motion.div 
                         style={{ bottom: `${((val + 20) / 40) * 100}%` }}
                         className="absolute left-1/2 -ml-2 w-4 h-4 bg-[#A35D34] border-2 border-white rounded shadow-[0_0_10px_#A35D34] pointer-events-none z-10"
                       />
                    </div>
                    <span className="text-[9px] font-mono text-[#8E9299]">{freqs[i]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right: Modules, Profiles & Diagnostics */}
        <section className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <div className="panel p-5 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database className="w-3 h-3 text-blue-400" />
                <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">Volume Profiles</h2>
              </div>
              <button 
                onClick={() => {
                  setEditingProfile({ name: 'NEW_PROFILE', media: 1, ringer: 1, alarm: 1 });
                  setShowProfileEditor(true);
                }}
                className="text-[9px] font-bold text-blue-400 uppercase"
              >
                + New
              </button>
            </div>
            
            <div className="grid grid-cols-1 gap-2">
              {profiles.map((p) => (
                <div 
                  key={p.name}
                  className={`group relative flex items-center justify-between p-2.5 rounded border transition-all cursor-pointer ${
                    activeProfile === p.name 
                      ? 'bg-[#212226] border-blue-400/50' 
                      : 'bg-zinc-900/30 border-[#2D2F36] hover:border-zinc-700'
                  }`}
                  onClick={() => applyProfile(p)}
                >
                  <div className="flex flex-col">
                    <span className={`text-[10px] font-bold tracking-tight uppercase ${activeProfile === p.name ? 'text-blue-400' : 'text-[#8E9299]'}`}>{p.name}</span>
                    <div className="flex gap-2 mt-1">
                      <div className="flex items-center gap-1">
                        <Music className="w-2 h-2 text-zinc-600" />
                        <span className="text-[8px] text-zinc-500">{Math.round(p.media * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Smartphone className="w-2 h-2 text-zinc-600" />
                        <span className="text-[8px] text-zinc-500">{Math.round(p.ringer * 100)}%</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingProfile(p);
                      setShowProfileEditor(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-white transition-opacity text-zinc-600"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-3 h-3 text-[#A35D34]" />
              <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">DSP Modules</h2>
            </div>
            
          <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'spatializer', label: 'Spatial', color: 'blue' },
                { key: 'edge', label: 'Edge', color: 'red' },
                { key: 'upsampling', label: 'AI', color: 'green' },
                { key: 'limiter', label: 'Limit', color: 'red' },
                { key: 'alignment432', label: '432Hz (Recom)', color: 'blue' },
                { key: 'subBlast', label: 'Sub', color: 'red' }
              ].map((mod) => (
                <button 
                  key={mod.key}
                  onClick={() => setModules(prev => ({ ...prev, [mod.key]: !prev[mod.key as keyof typeof modules] }))}
                  className={`flex items-center justify-between p-2 rounded border transition-all ${
                    modules[mod.key as keyof typeof modules] 
                      ? 'bg-[#212226] border-[#A35D34]/30' 
                      : 'bg-zinc-900/30 border-[#2D2F36] opacity-40'
                  }`}
                >
                  <span className="text-[9px] font-medium tracking-tight uppercase">{mod.label}</span>
                  <div className={`w-6 h-3 rounded-full relative p-0.5 transition-colors ${modules[mod.key as keyof typeof modules] ? 'bg-[#A35D34]' : 'bg-[#4D4E54]'}`}>
                    <motion.div 
                      animate={{ x: modules[mod.key as keyof typeof modules] ? 12 : 0 }}
                      className="w-2 h-2 bg-white rounded-full"
                    />
                  </div>
                </button>
              ))}
            </div>
            
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#2D2F36]/50">
              <button 
                onClick={() => {
                  setModules({
                    spatializer: true,
                    edge: true,
                    upsampling: false,
                    limiter: true,
                    alignment432: true,
                    subBlast: true
                  });
                  addLog("[DSP] Restored to Optimum Meditative Alignment (432Hz Core)");
                }}
                className="py-2 px-3 text-[9px] font-black tracking-widest uppercase rounded border border-cyan-500/30 bg-cyan-900/10 text-cyan-400 hover:bg-cyan-500/15 active:scale-[0.98] transition-all cursor-pointer"
              >
                OPTIMIZE ALIGNMENT
              </button>
              <button 
                onClick={() => {
                  setModules({
                    spatializer: false,
                    edge: false,
                    upsampling: false,
                    limiter: false,
                    alignment432: false,
                    subBlast: false
                  });
                  addLog("[DSP] All DSP modules bypassed for raw output.");
                }}
                className="py-2 px-3 text-[9px] font-black tracking-widest uppercase rounded border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900/60 active:scale-[0.98] transition-all cursor-pointer"
              >
                BYPASS ALL DSP
              </button>
            </div>
          </div>

          <div className="panel p-5 flex-none h-[300px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-3 h-3 text-blue-400" />
                <h2 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-[0.2em]">Diagnostics</h2>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black/40 rounded border border-[#2D2F36]">
                <span className="text-[8px] text-[#8E9299] uppercase">Calibrated</span>
                <span className={`text-[8px] font-mono ${frequencyStats?.isLocked ? 'text-[#00FF41]' : 'text-zinc-600'}`}>{frequencyStats?.isLocked ? 'LOCKED' : 'RAW'}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black/40 rounded border border-[#2D2F36]">
                <span className="text-[8px] text-[#8E9299] uppercase">State</span>
                <span className={`text-[8px] font-mono ${isActive ? 'text-[#00FF41]' : 'text-zinc-600'}`}>{isActive ? 'RUNNING' : 'SUSPENDED'}</span>
              </div>
            </div>
            <div className="flex-1 font-mono text-[9px] space-y-1.5 text-[#8E9299] overflow-y-auto">
               {logs.map((log, index) => (
                 <p key={index} className="flex gap-2">
                   <span className={log.includes('[OK]') ? 'text-[#00FF41]' : log.includes('[WARN]') ? 'text-amber-500' : log.includes('[PROFILE]') ? 'text-blue-400' : 'text-blue-400'}>
                     {log.split(' ')[0]}
                   </span>
                   {log.split(' ').slice(1).join(' ')}
                 </p>
               ))}
               <motion.span 
                 animate={{ opacity: [1, 0] }}
                 transition={{ repeat: Infinity, duration: 0.8 }}
                 className="inline-block w-1.5 h-3 bg-[#8E9299] ml-1 align-middle"
               />
            </div>
          </div>

          <div className="panel p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h2 className="text-[10px] font-bold text-teal-400 uppercase tracking-[0.2em]">Zen Mixer Protocol</h2>
                <span className="text-[8px] text-zinc-600 uppercase font-medium mt-0.5">Multi-Tone Harmonic Layering</span>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleCaptureToggle}
                  className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${
                    isRecording 
                      ? 'bg-[#A35D34]/20 border-[#A35D34] text-[#A35D34] animate-pulse' 
                      : 'bg-teal-500/10 border-teal-500/30 text-teal-400 hover:bg-teal-500/20'
                  }`}
                  title="Capture Zen Output"
                >
                  <Mic className="w-3 h-3" />
                  <span className="text-[8px] font-bold uppercase tracking-widest">{isRecording ? 'Capturing...' : 'Record'}</span>
                </button>
                <div className="status-tag bg-teal-500/10 text-teal-400">432Hz_TUNED</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest px-1">{t.environments}</span>
                <div className="grid grid-cols-2 gap-2">
                   {[
                     { id: 'ocean', label: 'Ocean', icon: Waves },
                     { id: 'rain', label: 'Rain', icon: CloudRain },
                     { id: 'drone', label: 'Drone', icon: Zap },
                     { id: 'schumann', label: 'Schumann', icon: Activity }
                   ].map((item: any) => (
                     <button
                       key={item.id}
                       onClick={() => toggleZen(item.id)}
                       className={`flex items-center gap-2 px-3 py-2 rounded border transition-all ${
                         zenMode === item.id ? 'bg-teal-500/20 border-teal-500 text-teal-400' : 'bg-black/40 border-[#2D2F36] text-zinc-500 hover:border-zinc-700'
                       }`}
                     >
                       <item.icon className="w-3.5 h-3.5" />
                       <span className="text-[8px] font-bold uppercase">{item.label}</span>
                     </button>
                   ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">{t.solfeggio} // Harmonic Mix</span>
                  {activeZenTones.size > 0 && (
                    <button 
                      onClick={() => {
                        activeZenTones.forEach(t => audio.toggleZenTone(t, false));
                        setActiveZenTones(new Set());
                        addLog("[ZEN] All tones disengaged.");
                      }}
                      className="text-[8px] text-[#A35D34] uppercase font-bold hover:underline"
                    >
                      Clear Mixer
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto px-1 custom-scrollbar">
                    {ZEN_FREQUENCIES.map((s) => (
                    <button
                      key={s.freq}
                      onClick={() => toggleZen(s.freq)}
                      className={`flex items-center justify-between px-3 py-2 rounded border transition-all ${
                        activeZenTones.has(s.freq) ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-black/40 border-[#2D2F36] text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex flex-col items-start leading-tight">
                        <span className="text-[9px] font-bold tracking-widest">{s.freq}Hz</span>
                        <span className="text-[7px] uppercase font-medium opacity-60">{s.label}</span>
                      </div>
                      <div className={`w-1.5 h-1.5 rounded-full ${activeZenTones.has(s.freq) ? 'bg-amber-400 animate-pulse' : 'bg-zinc-800'}`} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-500 uppercase font-bold">{t.sessionTimer}</span>
                <span className="text-[10px] font-mono text-teal-400">
                  {zenTimeRemaining > 0 
                    ? `${Math.floor(zenTimeRemaining / 60)}:${(zenTimeRemaining % 60).toString().padStart(2, '0')}`
                    : `${zenTimer}m`
                  }
                </span>
              </div>
              <input 
                type="range"
                min="1"
                max="60"
                value={zenTimer}
                onChange={(e) => setZenTimer(parseInt(e.target.value))}
                disabled={zenMode !== 'none'}
                className="w-full h-1 bg-[#2D2F36] rounded-lg appearance-none cursor-pointer accent-teal-500 disabled:opacity-20"
              />
            </div>

            <div className="mt-4 p-4 bg-zinc-900/40 border border-[#2D2F36] rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-zinc-500">
                <Terminal className="w-3 h-3 text-teal-500" />
                <span className="text-[9px] font-bold uppercase tracking-widest">Educational Advisory</span>
              </div>
              <p className="text-[9px] text-zinc-500 leading-relaxed italic">
                This frequency mixer is provided for **educational and entertainment purposes only**. 
                The biological or therapeutic effects of specific frequencies have not been clinically verified by this application. 
                Users are encouraged to verify the validity and safety of any frequency through independent research and official sources. 
                All frequency data referenced is compiled via community research and available public online sources (including YouTube frequency research results). 
                WebM recordings are saved directly to your browser's default **Downloads folder**.
              </p>
            </div>

            {zenMode !== 'none' && (
              <div className="bg-teal-500/5 border border-teal-500/20 rounded p-2 text-center">
                <span className="text-[8px] text-teal-400/70 uppercase animate-pulse italic">
                  {t.aligning}{zenMode.length > 3 ? zenMode.toUpperCase() : `${zenMode}Hz`}{t.resonance}
                </span>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Profile Editor Modal */}
      <AnimatePresence>
        {showProfileEditor && editingProfile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-6 flex items-center justify-center bg-zinc-950/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="panel p-8 w-full max-w-sm space-y-8"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-widest">Edit Profile</h2>
                <button onClick={() => setShowProfileEditor(false)} className="text-zinc-600 hover:text-white">
                  <VolumeX className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Name</label>
                  <input 
                    type="text"
                    value={editingProfile.name}
                    onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value.toUpperCase() })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs focus:border-blue-400 outline-none"
                  />
                </div>

                {[
                  { key: 'media', label: 'Media Transport', icon: Music },
                  { key: 'ringer', label: 'Communication (Ringer)', icon: Smartphone },
                  { key: 'alarm', label: 'Critical (Alarm)', icon: Zap }
                ].map((item) => (
                  <div key={item.key} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <item.icon className="w-3 h-3 text-zinc-600" />
                        <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{item.label}</label>
                      </div>
                      <span className="text-[10px] font-mono text-blue-400">{Math.round(editingProfile[item.key as keyof VolumeProfile] as number * 100)}%</span>
                    </div>
                    <input 
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={editingProfile[item.key as keyof VolumeProfile] as number}
                      onChange={(e) => setEditingProfile({ ...editingProfile, [item.key]: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowProfileEditor(false)}
                  className="flex-1 py-3 bg-[#2D2F36] rounded text-[10px] font-bold uppercase"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => saveProfile(editingProfile)}
                  className="flex-1 py-3 bg-blue-400 text-white rounded text-[10px] font-bold uppercase shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                >
                  Commit changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Footer */}
      <footer className="mt-4 border-t border-[#2D2F36] pt-4 flex justify-between items-center text-[9px] text-[#8E9299] font-mono tracking-wider uppercase">
        <div className="hidden sm:flex gap-6">
          <span>Channel: <span className="text-[#E0E2E6]">L+R STEREO</span></span>
          <span>Bitrate: <span className="text-[#E0E2E6]">32-BIT FLOAT / 192KHZ</span></span>
          <span>Engine: <span className="text-[#E0E2E6]">WASM_EDGE_V8</span></span>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-1.5">
            <Smartphone className="w-3 h-3" />
            <span>DEVICE: SM-G998B</span>
          </div>
          <div className="h-1.5 w-1.5 rounded-full bg-[#00FF41] shadow-[0_0_5px_#00FF41]"></div>
          <span className="text-[#00FF41]">CONNECTED</span>
        </div>
      </footer>
    </div>
  );
}
