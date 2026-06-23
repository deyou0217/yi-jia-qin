import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vue': ['vue'],
          'peerjs': ['peerjs']
        }
      }
    }
  },
  server: {
    port: 5173,
    https: false
  }
})
