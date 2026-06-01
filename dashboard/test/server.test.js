/**
 * Test script for dashboard/server.js utility functions
 */

const fs = require('fs');
const assert = require('node:assert');
const test = require('node:test');
const path = require('path');

const { readSecrets } = require('../server.js');

const SECRETS_FILE = path.join(__dirname, '../.secrets.json');
const originalReadFileSync = fs.readFileSync;

test('readSecrets error fallback logic', async (t) => {
  t.afterEach(() => {
    fs.readFileSync = originalReadFileSync;
  });

  await t.test('returns {} when file does not exist (throws error)', () => {
    fs.readFileSync = (filepath, encoding) => {
      if (filepath === SECRETS_FILE) {
        const err = new Error('ENOENT: no such file or directory');
        err.code = 'ENOENT';
        throw err;
      }
      return originalReadFileSync(filepath, encoding);
    };

    const result = readSecrets();
    assert.deepStrictEqual(result, {});
  });

  await t.test('returns {} when file contains malformed JSON', () => {
    fs.readFileSync = (filepath, encoding) => {
      if (filepath === SECRETS_FILE) {
        return '{ "github": { "pat": "token" }'; // missing closing brace
      }
      return originalReadFileSync(filepath, encoding);
    };

    const result = readSecrets();
    assert.deepStrictEqual(result, {});
  });

  await t.test('returns parsed object when file contains valid JSON', () => {
    const mockSecrets = { github: { pat: 'ghp_mock_token' } };
    fs.readFileSync = (filepath, encoding) => {
      if (filepath === SECRETS_FILE) {
        return JSON.stringify(mockSecrets);
      }
      return originalReadFileSync(filepath, encoding);
    };

    const result = readSecrets();
    assert.deepStrictEqual(result, mockSecrets);
  });
});
