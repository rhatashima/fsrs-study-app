import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
      // Firestore Emulator が必要なテストは npm test には含めない（npm run test:rules で実行）
      exclude: ['tests/rules/**', 'src/**/*.emulator.test.ts', 'node_modules/**'],
    },
  }),
)
