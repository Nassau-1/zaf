## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2025-02-14 - Fix Repository Path Traversal in Dashboard Server
**Vulnerability:** The dashboard server constructed file paths using raw, user-provided repository slugs (e.g., `repoSlug`) directly inside `path.resolve(REPOS_ROOT, repoSlug)`. This allowed attackers to use URI-encoded dot-dot-slash sequences (like `%2e%2e%2f`) to bypass basic directory traversal checks and access arbitrary sensitive files outside the intended `REPOS_ROOT` directory.
**Learning:** Node's `path.resolve` handles path normalization, but it does not prevent directory traversal if the resulting resolved path is not subsequently validated against an allowed boundary. Furthermore, URL-encoded traversal payloads can bypass basic string-matching validation if the input is not fully decoded prior to resolution.
**Prevention:** Always explicitly `decodeURIComponent` on user-provided path inputs. Construct the absolute path using `path.resolve()`, and then rigorously enforce directory boundaries by verifying that the resolved absolute path `.startsWith(BASE_DIR + path.sep)` (or is exactly `BASE_DIR`). If the validation fails, safely route the path to a known-invalid directory (e.g., `__INVALID_REPO__`) rather than throwing synchronous errors, which could lead to Denial of Service in HTTP servers lacking centralized error handling.
