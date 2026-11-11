import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command:
      'pnpm --dir internal-plugins/setting exec vite --host 127.0.0.1 --port 15177 --strictPort',
    url: 'http://127.0.0.1:15177',
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    screenshot: process.env.ZTOOLS_ALLOW_TEST_SCREENSHOTS === '1' ? 'only-on-failure' : 'off',
    trace: process.env.ZTOOLS_ALLOW_TEST_SCREENSHOTS === '1' ? 'retain-on-failure' : 'off'
  }
})
