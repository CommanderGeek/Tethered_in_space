import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// short commit hash when available in the GitHub Actions build
const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  // relative paths => works under any repo name on GitHub Pages
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(sha ? `${pkg.version}+${sha}` : `${pkg.version}-dev`),
  },
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: true },
});
