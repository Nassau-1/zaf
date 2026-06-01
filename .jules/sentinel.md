## 2026-06-01 - Secure CORS Origin Validation
**Vulnerability:** Weak CORS Origin validation bypass (e.g. `startsWith('http://localhost')` allows `http://localhost.attacker.com`).
**Learning:** String matching on origin headers is inherently insecure.
**Prevention:** Use `new URL(origin).hostname` to strictly compare domains instead of `startsWith()` or `includes()` when restricting CORS dynamically.
