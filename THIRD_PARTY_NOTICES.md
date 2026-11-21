# Third-Party Notices / 第三方声明

`dsh-oh-my-token` is MIT-licensed (see `LICENSE`). It contains or derives from
the works below; their notices are reproduced here as required.

## RTK — Apache License 2.0

- Project: RTK — https://github.com/rtk-ai/rtk
- License: Apache License 2.0 (full text: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt))
- Copyright: the RTK contributors.

`lib/rtk.js` is a JavaScript port of the RTK structural filters, obtained
through [`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)
(MIT, © 2026 Ebony-Vinyl), which ported them from the Rust RTK tool. Changes in
this port: translated to JavaScript, adapted to this plugin's module style, and
the diff-recovery marker now names this plugin's own recovery path instead of the
`rtk` binary. The filters' numeric thresholds and output shapes are kept close to
the originals.

The RTK-derived portion remains available under Apache-2.0; the rest of this
package is MIT. Apache-2.0 is compatible with MIT and does not change this
package's MIT license.

## codegraph — Functional Source License 1.1

- Project: codegraph — https://github.com/isink17/codegraph
- License: Functional Source License, Version 1.1 (FSL-1.1; source-available,
  converts to Apache-2.0 on 2028-03-18)
- Copyright © 2026 isink17.

No code from codegraph is copied into this package. The retrieval transform — a
symbol outline before a ranged read — is an independent implementation in
`lib/retrieval.js`, written from the idea alone. Ideas and algorithms are not
copyrightable, so codegraph's license does not apply to this package; the
acknowledgement is a courtesy. If code is ever copied from codegraph, its FSL
terms (including the non-commercial restriction before the change date) would
need to be honoured and could be incompatible with an MIT release.
