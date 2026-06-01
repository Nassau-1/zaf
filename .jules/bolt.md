## 2025-06-01 - Async Git Clone to Unblock Event Loop
**Learning:** In the Node.js backend (`dashboard/server.js`), calling `execSync` for heavy, slow operations like `git clone` during an HTTP request blocks the main event loop. This leads to massive latency spikes (e.g., from ~10ms up to hundreds of milliseconds) for all concurrent requests like checking fleet status.
**Action:** Replace `execSync` with asynchronous variants using `await util.promisify(exec)` to yield execution back to the event loop during the operation, preserving functionality while boosting application responsiveness.
