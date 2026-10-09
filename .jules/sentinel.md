## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2024-02-13 - Path Traversal using encoded URI components
**Vulnerability:** Attackers could bypass basic path filtering by using URL-encoded payloads like `%2e%2e%2f` to traverse directories, as the path was not properly decoded prior to validation.
**Learning:** Checking for traversal without strictly comparing the resolved path against a boundary (including `path.sep` to prevent sibling directory access) and without properly decoding the input beforehand leads to traversal vulnerabilities. Furthermore, throwing synchronous errors in Node HTTP routing can lead to DoS.
**Prevention:** Always decode inputs like `decodeURIComponent` and validate directory traversal by resolving the path and checking if it `startsWith(root + path.sep)` or is strictly equal to the root. If decoding fails, catch it and return a safely bounded invalid path instead of throwing.
