## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-02 - Async File I/O in Endpoints
**Learning:** Synchronous file system operations (`fs.readFileSync`, `fs.readdirSync`) within HTTP request handlers block the Node.js event loop, severely degrading performance under load.
**Action:** Always use asynchronous operations (`fs.promises`) in server endpoints.
