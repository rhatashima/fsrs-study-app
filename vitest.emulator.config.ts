import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * Firestore Emulator を使うテスト（npm run test:rules から起動する）。
 * - tests/rules/：Security Rules のテスト
 * - src/**\/*.emulator.test.ts：Firestore リポジトリのテスト
 * 同じ Emulator を共有するため、ファイルは順番に実行する。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/rules/**/*.test.ts', 'src/**/*.emulator.test.ts'],
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  }),
)
