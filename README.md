# Pulse Pong

A 40-second palm-controlled neon arcade match. MediaPipe hand detection runs
inside a Web Worker so the game canvas stays responsive while the camera is
being processed.

## Run locally

Camera access requires `localhost` or HTTPS. From this folder, run:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge.

## Test

```powershell
npm test
```
