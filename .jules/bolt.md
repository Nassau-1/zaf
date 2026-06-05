## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2024-06-02 - Async I/O in HTTP Handlers
**Learning:** Using synchronous `fs.readdirSync` and `fs.readFileSync` inside an HTTP handler for endpoints like `/api/repo/skills` blocks the Node.js event loop, degrading server performance for concurrent users.
**Action:** Always replace blocking synchronous I/O operations in HTTP endpoints with `await fs.promises.readdir` and `await Promise.all()` combined with `fs.promises.readFile` to maintain high throughput.
