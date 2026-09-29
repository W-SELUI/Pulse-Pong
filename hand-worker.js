/* MediaPipe inference lives off the animation thread. Only landmarks leave here. */
importScripts('./vendor/vision_bundle.js');
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await Vision.FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location.href).href);
      const options = {
        baseOptions: { modelAssetPath: new URL('./assets/hand_landmarker.task', self.location.href).href, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 1,
        // Slightly forgiving thresholds keep short motion-blur frames from
        // dropping an otherwise stable hand. The game still applies its own
        // jump and stale-frame protection before a swipe can score.
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.4,
        canvas: new OffscreenCanvas(640, 480),
      };
      try { detector = await Vision.HandLandmarker.createFromOptions(files, options); }
      catch {
        options.baseOptions.delegate = 'CPU';
        options.canvas = new OffscreenCanvas(640, 480);
        detector = await Vision.HandLandmarker.createFromOptions(files, options);
      }
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (data.type === 'frame') {
    try {
      const result = detector.detectForVideo(data.bitmap, data.time);
      self.postMessage({ type: 'landmarks', landmarks: result.landmarks[0] || null, time: data.time });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.bitmap.close(); }
  }
};
