## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-10-24 - Async File Operations in GET Handlers
**Learning:** Using synchronous `fs.readdirSync` and `fs.readFileSync` inside a map loop in an HTTP request handler blocks the Node.js event loop. If the directory contains many files, the server will stall handling other connections.
**Action:** Replace synchronous loops reading files within request handlers with `fs.promises.readdir` and `Promise.all` over `fs.promises.readFile` to maintain high concurrency.
