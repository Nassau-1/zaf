## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.


## 2026-08-20 - Fix Path Traversal in API
**Vulnerability:** The `REPOS_ROOT` combined with unvalidated user input via `path.resolve` in `/api/repo/context` and other endpoints allowed traversing to and exposing arbitrary directories on the filesystem (e.g. `?repo=../`).
**Learning:** Node.js `path.resolve` implicitly processes `..` segments. When `REPOS_ROOT` is used as a base, inputs must be strictly validated to ensure the resulting path remains within the intended boundary, otherwise it results in a critical Path Traversal / LFI vulnerability.
**Prevention:** Always validate resolved paths by checking that they start with the intended root directory, taking care to properly handle trailing slashes using `.startsWith(rootStr)` and `!== root`.
