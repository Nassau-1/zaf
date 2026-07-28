## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.
## 2026-10-18 - Path Traversal via `path.resolve`
**Vulnerability:** Arbitrary path traversal in HTTP endpoints (`/api/repo/context`, `/api/repo/skills`, etc.) via unsanitized user query strings resolved directly against a base path using `path.resolve(REPOS_ROOT, input)`.
**Learning:** Even when `path.resolve` normalizes `..` segments, standard HTTP clients process relative URL resolution dynamically, meaning if the input resolves backwards past the base path, it effectively creates a global file reading vector (e.g. exposing `/etc/passwd`).
**Prevention:** Explicit boundary verification logic is critical. After resolving paths against the base directory, always mandate that `resolvedPath.startsWith(basePath + path.sep) || resolvedPath === basePath` to strictly enforce the directory constraint before processing further.
