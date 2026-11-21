# Third-Party Notices / 第三方声明

`dsh-oh-my-token` is MIT-licensed (see `LICENSE`). It contains or derives from
the works below; their notices are reproduced here as required.

## RTK — Apache License 2.0

- Project: RTK — https://github.com/rtk-ai/rtk
- License: Apache License 2.0 (full text: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt))
- Copyright: the RTK contributors.

`lib/rtk.js` is an independent JavaScript implementation of the RTK structural
filter behaviour, written from the behaviour of the RTK tool (Apache-2.0). No
third-party JavaScript port was copied. The numeric thresholds and output shapes
are kept compatible with RTK; the diff-recovery marker names this plugin's own
recovery path instead of the `rtk` binary.

The RTK-style portion is used under Apache-2.0; the rest of this package is MIT.
Apache-2.0 is compatible with MIT and does not change this package's MIT license.

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
