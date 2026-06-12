## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2026-06-11 - Asynchronous File Reads in Node.js Endpoints
**Learning:** In `dashboard/server.js`, using synchronous operations like `fs.readdirSync` and `fs.readFileSync` within high-throughput HTTP endpoints (e.g., `/api/repo/skills`) blocks the Node.js event loop, degrading concurrent throughput significantly.
**Action:** Always replace synchronous file reads inside HTTP handlers with asynchronous equivalents (`fs.promises.readdir`, `fs.promises.readFile`) combined with `Promise.all()` when processing multiple files.
