import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
      // Security Rules のテスト（Phase 5）は Emulator が必要なため npm test には含めない
      exclude: ['tests/rules/**', 'node_modules/**'],
    },
  }),
)
