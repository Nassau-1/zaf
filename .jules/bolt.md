## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2024-06-25 - Prevent event loop blocking on large log arrays
**Learning:** O(N²) nested iterations for string manipulations or subsequence matching on large process log arrays block the Node.js event loop and cause API timeouts.
**Action:** Use an O(N) approach with `Map` for frequency counting and caching signatures to decouple parsing from request fulfillment.
