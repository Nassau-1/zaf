## 2024-05-15 - Unblock Event Loop during Git Clone
**Learning:** Using `execSync` for network-bound tasks like `git clone` severely blocks the Node.js event loop, increasing latency from ~15ms to ~10000ms for incoming requests.
**Action:** Always wrap `child_process.exec` using `util.promisify` to execute long-running commands like `git clone` asynchronously (`await execAsync`) within API handlers.
