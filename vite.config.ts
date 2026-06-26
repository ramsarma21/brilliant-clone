import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const forceFullReloadAfterSourceEdits = () => ({
  name: 'force-full-reload-after-source-edits',
  // Trigger a full page reload on src edits WITHOUT returning [] — returning an empty
  // module list suppresses Vite's normal invalidation, which left stale transformed
  // modules being served. By not returning, Vite still invalidates/re-transforms the
  // changed file and the extra full-reload just resets the running game state.
  handleHotUpdate({ file, server }: { file: string; server: { ws: { send: (event: { type: 'full-reload' }) => void } } }) {
    if (!file.includes('/src/')) return
    if (!/\.(tsx?|css)$/.test(file)) return
    server.ws.send({ type: 'full-reload' })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [forceFullReloadAfterSourceEdits(), react()],
  server: {
    // Force polling so edits are reliably detected on macOS (native fs events are
    // sometimes missed, especially with atomic/rename-style writes), which was
    // causing changes to require a manual hard reload to show up.
    watch: { usePolling: true, interval: 120 },
    // Never let the browser cache dev assets, so a reload always gets fresh code.
    headers: { 'Cache-Control': 'no-store' },
  },
})
