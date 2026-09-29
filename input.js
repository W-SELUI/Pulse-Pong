// Adaptive smoothing for camera landmarks: stable when the palm is still,
// but increasingly responsive as it moves faster.
export class OneEuroFilter {
  constructor(minCutoff = 2.15, beta = 0.14) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.reset();
  }

  reset() {
    this.value = null;
    this.raw = null;
    this.time = null;
    this.derivative = 0;
  }

  filter(value, time) {
    if (this.value === null || time - this.time > 0.3) {
      this.value = value;
      this.raw = value;
      this.time = time;
      return value;
    }

    const delta = Math.max(0.001, time - this.time);
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * delta));
    const derivative = (value - this.raw) / delta;
    this.derivative += alpha(1) * (derivative - this.derivative);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.value);
    this.raw = value;
    this.time = time;
    return this.value;
  }
}
