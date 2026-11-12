# Bundled SHA-256 implementation

This directory contains the unmodified JavaScript import closure for SHA-256 from `@noble/hashes` **2.4.0**, under the accompanying MIT [LICENSE](LICENSE).

Upstream release: https://github.com/paulmillr/noble-hashes/releases/tag/2.4.0

Official package: https://registry.npmjs.org/@noble/hashes/-/hashes-2.4.0.tgz

The package was acquired with `npm pack @noble/hashes@2.4.0 --ignore-scripts`; its complete tarball matched the registry's SHA-512 integrity value:

```text
sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==
```

Tarball SHA-256: `e1946149b780017b2564fcc092cb01c04e1d7f20627d0296c17da8868f4436dc`.

Only `sha2.js` and its three transitive JavaScript dependencies are shipped. Files are not rewritten, bundled, or minified. Source-map comments from upstream remain; source maps are not required at runtime and are not included. There is no runtime npm installation or external network request.

| Original file | SHA-256 |
| --- | --- |
| sha2.js | `471746bba6ec4c6238ca41358d1d3b40b6ff31cf3363f0b4d550c649c1a8e83b` |
| utils.js | `037ad49adb78168b6b699598fd33f85f7877456b1d28b4d032e2a1a16807947c` |
| _u64.js | `b09da8c07fe8187c07649494cdb7cd0bcf13df90b506a9473d19e4d5f8c2e102` |
| _md.js | `60cf3010fda89e3e4d3f0e7ff1ce249e9c467f34b4fd41b6fd6101d9f69be763` |
| LICENSE | `4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec` |

CHRONOS calls `sha256.create()`, sequential `update()`, `digest()`, and `destroy()`. Any update must refresh provenance, preserve the license, rerun native reference/bounded-read tests, and exercise the actual worker through the maintained server and unchanged CSP.
