import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 페이지: 가맹점 찾기(index.html), 가맹 권유 지도(mealcard.html), 관리자 검수(admin.html)
  build: {
    rollupOptions: {
      input: { main: 'index.html', mealcard: 'mealcard.html', admin: 'admin.html' },
    },
  },
})
