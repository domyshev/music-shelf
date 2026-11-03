import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4175', viewport: { width: 1280, height: 800 }, launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {} },
  webServer: { command: 'npm run build && npm start', url: 'http://127.0.0.1:4175/healthz', reuseExistingServer: false, env: { PORT: '4175', HOST: '127.0.0.1', SHELF_ORIGIN: 'http://127.0.0.1:4175', SHELF_DB_PATH: 'local/ui-tests.sqlite' } },
});
