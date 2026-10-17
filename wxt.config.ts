import { defineConfig } from 'wxt';

export default defineConfig({
  webExt: { disabled: true },
  manifest: {
    name: 'Gemini Folders',
    description: '用資料夾、子資料夾與批次移動整理 Gemini 聊天。資料保存在本機。',
    permissions: ['storage'],
    minimum_chrome_version: '120',
    action: { default_title: '開啟 Gemini Folders 管理頁' },
  },
});
