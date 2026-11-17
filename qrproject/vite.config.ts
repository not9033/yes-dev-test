import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const projectId = env.VITE_FIREBASE_PROJECT_ID
  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
    ],
    server: {
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.VITE_FUNCTIONS_PORT || '5001'}`,
          changeOrigin: true,
          rewrite: (path: string) => `/${projectId}/asia-southeast1/api${path.slice(4)}`,
        },
      },
    },
  }
})
