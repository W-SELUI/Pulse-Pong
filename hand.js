export const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const timeout = (promise, ms, message, signal) => {
  let timer, cancel;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    cancel = () => reject(new Error('Camera setup cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  })]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); });
};

export class HandTracker {
  constructor(video, onLandmarks, onError) { this.video = video; this.onLandmarks = onLandmarks; this.onError = onError; this.generation = 0; this.active = false; }
  async start(onStatus) {
    this.stop();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera mode needs HTTPS or localhost. You can still play with mouse or touch.');
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) throw new Error('This browser cannot run the hand tracker. Try a current Chrome or Edge, or use mouse / touch.');
    try {
      onStatus('Allow your camera to join the club…');
      const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const cameraRequest = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: mobile ? { ideal: 480, max: 640 } : { ideal: 640 }, height: mobile ? { ideal: 360, max: 480 } : { ideal: 480 }, frameRate: mobile ? { ideal: 24, max: 24 } : { ideal: 30, max: 30 } } });
      cameraRequest.then(stream => { if (!isCurrent()) stream.getTracks().forEach(track => track.stop()); }, () => {});
      const stream = await timeout(cameraRequest, 25000, 'Camera permission is still waiting. Allow access, then try again—or play with mouse / touch.', signal);
      if (!isCurrent()) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream; this.video.srcObject = stream;
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (isCurrent()) this.fail('The camera disconnected. Reconnect it and start again, or choose mouse / touch.'); });
      await timeout(this.video.play(), 10000, 'The camera did not start. Close other apps using it, then try again.', signal);
      if (!isCurrent()) return false;
      onStatus('Warming up your fingertip blade…');
      const worker = this.worker = new Worker(new URL('./hand-worker.js', import.meta.url));
      await timeout(new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (!isCurrent()) return;
          if (data.type === 'ready') resolve();
          else if (data.type === 'error') reject(new Error('The hand tracker could not load. Try again, or use mouse / touch.'));
        };
        worker.onerror = () => reject(new Error('The hand tracker could not start in this browser. Try Chrome or Edge, or play with mouse / touch.'));
        worker.postMessage({ type: 'init' });
      }), 35000, 'The hand tracker took too long to load. Try again, or play with mouse / touch.', signal);
      if (!isCurrent()) return false;
      this.active = true; this.busy = false; this.lastCapture = 0; this.lastVideoTime = -1; this.lastResponse = performance.now();
      worker.onmessage = ({ data }) => {
        if (!isCurrent()) return;
        this.busy = false; this.lastResponse = performance.now();
        if (data.type === 'landmarks') this.onLandmarks(this.lastResponse - data.time < 300 ? data.landmarks : null, data.time / 1000);
        else if (data.type === 'error') this.fail('Hand tracking stopped. Start again, or switch to mouse / touch.');
      };
      worker.onerror = () => { if (isCurrent()) this.fail('Hand tracking stopped. Start again, or switch to mouse / touch.'); };
      const capture = async now => {
        if (!isCurrent() || !this.active) return;
        this.raf = requestAnimationFrame(capture);
        if (document.hidden) { this.lastResponse = now; return; }
        if (now - this.lastResponse > 15000) { this.fail('The camera stopped responding. Try again, or use mouse / touch.'); return; }
        if (this.busy || now - this.lastCapture < 33 || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
        this.busy = true; this.lastCapture = now; this.lastVideoTime = this.video.currentTime;
        try {
          const bitmap = await createImageBitmap(this.video);
          if (!isCurrent() || !this.active) { bitmap.close(); return; }
          worker.postMessage({ type: 'frame', bitmap, time: now }, [bitmap]);
        } catch { if (isCurrent()) this.fail('The camera frame could not be read. Try again, or use mouse / touch.'); }
      };
      this.raf = requestAnimationFrame(capture);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      this.stop();
      const messages = {
        NotAllowedError: 'Camera access was blocked. Allow it in your browser’s site settings, or play with mouse / touch.',
        NotFoundError: 'No camera found. Connect one, or play with mouse / touch.',
        NotReadableError: 'Your camera is busy. Close other camera apps, then try again.',
        OverconstrainedError: 'This camera could not use the requested settings. Try another camera, or mouse / touch.',
      };
      throw new Error(messages[error.name] || error.message);
    }
  }
  fail(message) { this.stop(); this.onError(message); }
  stop() {
    this.generation++; this.active = false;
    this.abort?.abort(); this.abort = null;
    cancelAnimationFrame(this.raf); this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
  }
}
