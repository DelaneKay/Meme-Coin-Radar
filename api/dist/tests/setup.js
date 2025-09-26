"use strict";
global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
process.env.NODE_ENV = 'test';
process.env.DEXSCREENER_BASE = 'https://api.dexscreener.com';
process.env.BIRDEYE_BASE = 'https://public-api.birdeye.so';
process.env.GECKOTERMINAL_BASE = 'https://api.geckoterminal.com';
jest.setTimeout(10000);
afterEach(() => {
    jest.clearAllMocks();
});
//# sourceMappingURL=setup.js.map