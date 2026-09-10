## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Path Traversal Vulnerability in Repo Endpoints
**Vulnerability:** Multiple endpoints in `dashboard/server.js` used `path.resolve(REPOS_ROOT, repoSlug)` or `path.join(REPOS_ROOT, repoSlug)` without boundary checks, allowing attackers to read or write arbitrary files on the local filesystem by supplying payloads like `../../../etc/passwd`.
**Learning:** `path.resolve` automatically evaluates `..` segments, meaning absolute containment cannot be guaranteed without explicitly checking if the resolved path still resides within the intended directory base.
**Prevention:** Always implement a strict boundary check after resolution (e.g., `resolvedPath.startsWith(safeRoot)`) and ensure the root string ends with a directory separator to prevent partial prefix matching bypasses.
