import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', environmentOptions: { jsdom: { url: 'https://gemini.google.com/app?hl=zh-TW' } }, include: ['tests/**/*.test.ts'], restoreMocks: true },
});
