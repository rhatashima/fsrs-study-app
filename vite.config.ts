import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Firebase SDK（Authentication + Firestore）だけで約 550 kB（gzip 約 160 kB）あり、起動直後に必要なので分割できない。
    // それを許容する値にする（これを超えるファイルができたら、分割や不要な依存を見直す）
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // ライブラリをアプリ本体と別のファイルに分ける（アプリを更新しても、ライブラリ部分はブラウザのキャッシュを使える）
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
})
