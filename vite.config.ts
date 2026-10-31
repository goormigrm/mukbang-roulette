/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// GitHub Pages 프로젝트 사이트 경로 (https://goormigrm.github.io/mukbang-roulette/)
export default defineConfig({
  base: '/mukbang-roulette/',
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'], // Node에는 localStorage가 없어 메모리로 흉내 낸다
  },
})
