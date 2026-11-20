import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

function resolveCommitHash(): string {
  const fromEnv = process.env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .slice(0, 7);
  } catch {
    return 'local';
  }
}

const buildTime = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
}).format(new Date());

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/html-notes/' : './',
  plugins: [solidPlugin()],
  define: {
    __APP_COMMIT__: JSON.stringify(resolveCommitHash()),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
});
