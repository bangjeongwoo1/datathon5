import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 페이지: 첫 화면(index.html), 가맹점 지도(finder.html), 가맹 권유 지도(mealcard.html), 관리자 검수(admin.html)
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        finder: 'finder.html',
        mealcard: 'mealcard.html',
        admin: 'admin.html',
      },
    },
  },
})
