// Jest setup file for test configuration

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DEXSCREENER_BASE = 'https://api.dexscreener.com';
process.env.BIRDEYE_BASE = 'https://public-api.birdeye.so';
process.env.GECKOTERMINAL_BASE = 'https://api.geckoterminal.com';

// Global test timeout
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});