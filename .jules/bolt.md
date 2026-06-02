## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-02 - Async File Operations in HTTP Handlers
**Learning:** Using synchronous file operations (`fs.readdirSync`, `fs.readFileSync`) within array-processing map functions on an HTTP request handler blocks the entire Node.js event loop, creating a bottleneck for concurrent requests.
**Action:** When creating or modifying HTTP endpoints that process lists of files, utilize asynchronous alternatives like `fs.promises.readdir` combined with `Promise.all` and `fs.promises.readFile` to maintain concurrency and throughput.
