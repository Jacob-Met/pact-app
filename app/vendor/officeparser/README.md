# officeParser 8.7.1
Official slim browser distribution from https://registry.npmjs.org/officeparser/-/officeparser-8.7.1.tgz.
Upstream: https://github.com/harshankur/officeParser
MIT license in LICENSE; bundled dependency notices are retained in the distributed module.
The npm archive was checked against its published SHA-512 integrity before extracting.
PACT uses only DOCX parsing and text generation, inside a terminable worker. No remote assets or OCR.

## PACT paragraph-style numbering correction
The pinned upstream bundle is patched by scripts/patch-officeparser-numbering.mjs.
The original bundle SHA-256 is 98f015c4242aee96acb332888a1d4bd72f8eccd24853675ed824a9e423828aba.
To reproduce, restore the official 8.7.1 slim module, then run that script.
Two hooks retain style numbering properties and feed inherited properties into the existing numbering engine.
The readable implementation is app/agreement-word-numbering.mjs. Explicit paragraph overrides,
including numId=0, remain authoritative. Empty section-break carriers do not advance inherited numbering.
No heading appearance is used to invent a number. Previously saved agreement text is unchanged.
