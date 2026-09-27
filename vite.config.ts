import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // maplibre-gl loads its web worker via a sibling path; prebundling moves it
    exclude: ['maplibre-gl'],
  },
})
