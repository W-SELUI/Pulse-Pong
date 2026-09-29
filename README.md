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

## Hosting

This is a provider-neutral static website. Push the complete folder to a
GitHub repository first, then connect that repository to whichever hosting
provider you choose later.

It does not require a build command or output directory. The deployed website
must use HTTPS so the browser can request camera access. Both Vercel and
Netlify provide HTTPS for deployed sites.

The hand landmarks, photos, and video frames stay in the visitor's browser and
are not uploaded or stored by this project.
