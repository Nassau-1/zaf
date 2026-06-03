## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2026-06-03 - Asynchronous Event Loop Blocking in API Handlers
**Learning:** Using synchronous file system operations like `fs.readdirSync` and `fs.readFileSync` inside Node.js request handlers (like `/api/repo/skills` in `dashboard/server.js`) creates a significant performance bottleneck by blocking the main event loop, preventing the server from handling concurrent requests.
**Action:** Always prefer asynchronous equivalents (`fs.promises.readdir`, `fs.promises.readFile`) and wrap multiple file reads inside `Promise.all()` to achieve concurrent, non-blocking operations. Ensure parent route handlers are `async`.
