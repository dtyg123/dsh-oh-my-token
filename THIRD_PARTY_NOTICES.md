# Third-Party Notices / 第三方声明

`dsh-oh-my-token` is MIT-licensed (see `LICENSE`). It contains or derives from
the works below; their notices are reproduced here as required.

## RTK — Apache License 2.0

- Project: RTK — https://github.com/rtk-ai/rtk
- License: Apache License 2.0 (full text: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt))
- Copyright: the RTK contributors.

`lib/rtk.js` is a JavaScript port of the RTK structural filters, obtained
through an MIT-licensed intermediate port (its notice is below), which ported
them from the Rust RTK tool. Changes in this port: translated to JavaScript,
adapted to this plugin's module style, and the diff-recovery marker now names
this plugin's own recovery path instead of the `rtk` binary. The filters'
numeric thresholds and output shapes are kept close to the originals.

The RTK-derived portion remains available under Apache-2.0; the rest of this
package is MIT. Apache-2.0 is compatible with MIT and does not change this
package's MIT license.

### Ported-by notice (MIT)

The ported filter code was obtained through a third-party MIT-licensed port.
Its notice is retained here as required:

Copyright (c) 2026 Ebony-Vinyl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

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
