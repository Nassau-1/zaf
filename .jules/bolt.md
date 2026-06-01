## 2025-02-14 - Optimize Array Lookup in Skill Extraction
**Learning:** Checking for element existence in an array (`array.find(x => x.sig === sig)`) inside deeply nested loops can lead to poor performance and even memory issues due to string creation logic (O(N) lookup).
**Action:** Use a `Set` for `O(1)` lookups when verifying uniqueness during nested iterations, avoiding unnecessary iteration over arrays.
