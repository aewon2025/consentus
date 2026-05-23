class PitchShifterNode extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'pitch',
      defaultValue: 1.0,
      minValue: 0.5,
      maxValue: 2.0
    }];
  }

  constructor() {
    super();
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const pitch = parameters.pitch[0];

    // If pitch is 1.0, just pass through to save CPU and avoid artifacts
    if (Math.abs(pitch - 1.0) < 0.001) {
      for (let channel = 0; channel < input.length; channel++) {
        output[channel].set(input[channel]);
      }
      return true;
    }

    // Basic resampling logic with linear interpolation
    // Note: To avoid "phasing" we'd need a multi-grain approach, 
    // but this is better than the previous skipping.
    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      
      for (let i = 0; i < inputChannel.length; i++) {
        this.phase += pitch;
        const index = Math.floor(this.phase) % inputChannel.length;
        const nextIndex = (index + 1) % inputChannel.length;
        const frac = this.phase % 1;
        
        // Linear interpolation
        outputChannel[i] = inputChannel[index] * (1 - frac) + inputChannel[nextIndex] * frac;
      }
    }
    return true;
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterNode);
