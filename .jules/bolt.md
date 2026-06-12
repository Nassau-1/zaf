## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-13 - Async File I/O in API Handlers
**Learning:** Using synchronous file operations (`fs.readdirSync`, `fs.readFileSync`) inside a map loop in an HTTP GET handler blocks the Node.js event loop, causing severe latency under concurrent load.
**Action:** Replace synchronous FS operations with `fs.promises` and use `Promise.all()` to process multiple files concurrently without blocking the main thread.
