const assert = require('assert');
const http = require('http');
const EventEmitter = require('events');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');

const Module = require('module');
const originalRequire = Module.prototype.require;

// Intercept `require('vscode')` to mock the configuration correctly
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: () => 'http://localhost:4242'
        })
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Load the extension code and export `apiRequest` dynamically
const extensionCode = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
const moduleExportsMock = { exports: {} };
const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', extensionCode + '\nmodule.exports.apiRequest = typeof apiRequest !== "undefined" ? apiRequest : null;');
fn(moduleExportsMock, moduleExportsMock.exports, require, path.join(__dirname, '..'), path.join(__dirname, '../extension.js'));

const apiRequest = moduleExportsMock.exports.apiRequest;

// Restore the original require once loaded
Module.prototype.require = originalRequire;

describe('apiRequest', function() {
  let httpStub;

  beforeEach(() => {
    httpStub = sinon.stub(http, 'request');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should parse valid JSON response', async function() {
    httpStub.callsFake((opts, cb) => {
      const req = new EventEmitter();
      req.end = () => {};
      req.write = () => {};
      const res = new EventEmitter();
      setTimeout(() => {
        cb(res);
        res.emit('data', '{"success":');
        res.emit('data', 'true}');
        res.emit('end');
      }, 5);
      return req;
    });

    const result = await apiRequest('GET', '/test');
    assert.deepStrictEqual(result, { success: true });
  });

  it('should return raw string for malformed JSON response', async function() {
    httpStub.callsFake((opts, cb) => {
      const req = new EventEmitter();
      req.end = () => {};
      req.write = () => {};
      const res = new EventEmitter();
      setTimeout(() => {
        cb(res);
        res.emit('data', '{"broken":');
        res.emit('data', 'json');
        res.emit('end');
      }, 5);
      return req;
    });

    const result = await apiRequest('GET', '/test');
    assert.strictEqual(result, '{"broken":json');
  });
});
