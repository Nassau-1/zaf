## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-13 - Async File System Operations
**Learning:** Using synchronous file operations (`fs.readdirSync`, `fs.readFileSync`) in HTTP request handlers blocks the Node.js event loop, degrading performance under concurrent load.
**Action:** Replace synchronous I/O with asynchronous methods (`fs.promises.readdir`, `fs.promises.readFile`) combined with `Promise.all` for parallel processing to maintain a non-blocking event loop.
