import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Ship models are imported straight from ../normalized (the Blender output), so the dev server
// is allowed to read the parent folder instead of keeping a second copy in public/.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Native file watching on Windows can miss quick successive saves and keep serving stale modules.
    // Polling costs a little CPU but always picks up changes.
    watch: { usePolling: true, interval: 150 },
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
