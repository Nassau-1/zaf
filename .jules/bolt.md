
## 2024-10-10 - Prevent O(N²) Array Allocations in Recursive Traversals
**Learning:** Using `results.concat()` in recursive directory traversals (like `walkDir`) causes O(N²) array allocations and can lead to V8 heap out-of-memory errors on large codebases.
**Action:** Always pass a `results` array by reference and use `.push()` to achieve amortized O(N) time and memory complexity.
