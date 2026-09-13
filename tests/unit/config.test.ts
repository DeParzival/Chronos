// ============================================================
// SagaFlow — Unit Test: Configuration Module
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set valid defaults for each test
    process.env['PORT'] = '3000';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'info';
    process.env['DATABASE_URL'] = 'postgresql://sagaflow:sagaflow@localhost:5432/sagaflow';
    process.env['REDIS_URL'] = 'redis://localhost:6379';
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it('should load valid configuration from environment variables', () => {
    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('test');
    expect(config.logLevel).toBe('info');
    expect(config.databaseUrl).toBe('postgresql://sagaflow:sagaflow@localhost:5432/sagaflow');
    expect(config.redisUrl).toBe('redis://localhost:6379');
  });

  it('should use default values for optional fields', () => {
    delete process.env['PORT'];
    delete process.env['NODE_ENV'];
    delete process.env['LOG_LEVEL'];

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
  });

  it('should throw an error when DATABASE_URL is missing', () => {
    delete process.env['DATABASE_URL'];

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });

  it('should throw an error when REDIS_URL is missing', () => {
    delete process.env['REDIS_URL'];

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });

  it('should throw an error when DATABASE_URL has invalid prefix', () => {
    process.env['DATABASE_URL'] = 'mysql://localhost:3306/db';

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });

  it('should coerce PORT to a number', () => {
    process.env['PORT'] = '8080';

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe('number');
  });

  it('should reject invalid NODE_ENV values', () => {
    process.env['NODE_ENV'] = 'staging';

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });
});
