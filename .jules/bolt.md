## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2025-01-20 - Prevent Event Loop Blocking in HTTP Handlers
**Learning:** In vanilla Node.js, mapping over arrays with synchronous file system calls (like `fs.readFileSync`) within an HTTP endpoint blocks the entire event loop, causing server lag when fetching multiple files.
**Action:** Replace synchronous operations with asynchronous ones (e.g., `fs.promises.readFile`) inside `Promise.all()` to unblock the main thread and allow concurrent request handling.
