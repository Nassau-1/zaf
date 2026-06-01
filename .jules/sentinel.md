## 2024-05-30 - Prevent Command Injection via execFileSync
**Vulnerability:** Command injection through unsanitized user payload (like GitHub `name` and `email`) being concatenated directly into `execSync` strings when used with `shell: true`.
**Learning:** Even if quotes are removed, malicious actors can inject execution chains using backticks or other shell metacharacters because `shell: true` evaluates the entire concatenated string.
**Prevention:** Avoid `shell: true` and instead use `execFileSync` (or `spawnSync`), passing dynamic variables securely inside an arguments array.
