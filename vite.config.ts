import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Kurzer Commit-Hash, wenn im GitHub-Actions-Build verfügbar
const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  // relative Pfade => funktioniert unter jedem Repo-Namen auf GitHub Pages
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(sha ? `${pkg.version}+${sha}` : `${pkg.version}-dev`),
  },
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: true },
});
