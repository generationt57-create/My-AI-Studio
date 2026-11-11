<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# My AI Studio

My AI Studio provides Subtitle, Recap, and Dubbing workflows backed by Groq Whisper, Gemini, FFmpeg, and Burmese neural speech providers.

## Local Setup

Requires Node.js 22+, FFmpeg, and Myanmar-capable fonts (Noto Sans Myanmar is recommended).

1. Install dependencies with `npm ci`.
2. Set `GEMINI_API_KEY` and `GROQ_API_KEY` in the server environment. The browser does not collect or store provider keys.
3. Run `npm run dev` and open the URL printed by the server.

`APP_DATA_DIR` can point to a writable persistent directory. Without it, the app keeps its existing `data/` and `uploads/` locations under the working directory. `PORT` defaults to 3000.

## Render Deployment

The included `render.yaml` deploys the Docker image, mounts a persistent disk at `/var/data`, configures `APP_DATA_DIR=/var/data`, and uses `/api/health` for health checks. Add `GEMINI_API_KEY` and `GROQ_API_KEY` as Render secret environment variables before deploying. The Docker image installs FFmpeg, Fontconfig, and Noto fonts and builds the Vite frontend.

The web service needs enough disk space for uploaded source videos and generated exports. Increase the Render disk size for the expected workload. API keys must only be configured in the server/deployment environment.

## Validation

- `npm run lint` runs the TypeScript check.
- `npm run build` builds the production frontend.
