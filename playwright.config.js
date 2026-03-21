const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './src/test',
    timeout: 120000,
    use: {
        baseURL: 'http://localhost:8080',
        headless: true,
        screenshot: 'only-on-failure',
        video: 'on',
        viewport: { width: 1280, height: 800 },
    },
    webServer: {
        command: 'python -m http.server 8080 --directory src',
        port: 8080,
        reuseExistingServer: true,
    },
});
