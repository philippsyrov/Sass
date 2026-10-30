# Ready-to-run Mac bundles

The release builder prepares a complete, versioned bundle on a build Mac. The
person who installs it needs no Git, npm, compiler, or separate Node installation.
No bundle is published by this script. Check the repository's current GitHub
release and assets for published availability. Verified Mac bundles require
**macOS 15 or newer** because that is the deployment target of the Canvas
libraries. The installer checks this before downloading release data. Other
platforms and architectures remain unverified.

## Release inputs

Build on each target Mac architecture: `darwin-arm64` and `darwin-x64`. Do not
copy native dependencies from one architecture to the other. A target is available
only after its real native and offline tests pass.

1. Prepare a clean source checkout at the reviewed commit. Run `npm ci`,
   `npm run verify`, and `npm test`. Keep that checkout for development. In a
   separate clean staging checkout, run `npm ci --omit=dev` with optional
   dependencies and package install scripts enabled. Copy the verified `dist/`
   into that staging checkout. Native preparation can require compiler tools on
   the build Mac. These tools are not needed on the install Mac.
2. Obtain the official Node archive named in `release/inputs.example.json`.
   The builder checks its pinned SHA-256 before it extracts `bin/node` and the
   complete Node license. It does not package npm. The current pin is Node
   **v24.22.2**, from the [official release checksums](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt).
3. On the build host, obtain only the files in `release/model-pin.json` from
   the exact recorded model revision. Put them under a model input directory,
   with the recorded relative paths. Use the revision in every download URL.
   The builder checks every byte count and SHA-256. It does not download files.
4. Prepare a reviewed license directory with all files below. Retain the
   dependency license files inside `node_modules`. Include the licenses and
   notices of bundled native libraries and artwork, including the Poppins font,
   in the third-party notice collection. Audit the collection against the actual
   target bundle before release.
5. Prepare PostgreSQL from the pinned official source with the
   [local runtime build recipe](../release/postgres/README.md). The arm64
   candidate replaces only the npm wrapper's native payload; the wrapper is
   unchanged. This removes the additional EnterpriseDB supplier libraries from
   this bundle. Keep the matching source, recipe, relocation script and notice.
6. Copy `release/inputs.example.json` to `.release-work/inputs.json`. Use
   relative input paths. Keep prepared runtimes, model weights, release archives,
   and personal paths out of source control.

```sh
node scripts/build-release.mjs ./.release-work/inputs.json ./.release-work/output
```

The command does not read an installed Sass directory. It uses a temporary
staging directory, checks source symlinks before it copies their contents, and
emits only regular files and directories. It retains only the target
platform/architecture of ONNX Runtime, leaving its licenses intact. It excludes asset screenshots. It
checks the file inventory, starts the private Node, checks database executables,
loads canvas, and runs an offline memory comparison through the isolated memory
process. A failure prevents release metadata from being produced. Existing
release output is not overwritten.

A completed build produces a `.tar.gz`, a `.tar.gz.json` sidecar, a `sass-PLATFORM.json` metadata alias, and a `.sha256`
file. The sidecar records the **actual compressed byte count and SHA-256**. The
manifest records each uncompressed file's byte count, SHA-256, and executable
flag. `payloadBytes` excludes the manifest; `unpackedBytes` includes the manifest.
These are logical file sizes. Filesystem allocation and free working space can
be larger. No final archive size is known until a real build completes.

## Font

`assets/fonts/Poppins-Bold.ttf` is Poppins Bold v4.004. The copyright notice and SIL OFL 1.1 license are in `assets/fonts/OFL.txt`.

## Model and terms

New bundles use
[`onnx-community/embeddinggemma-2-ONNX`](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX)
at revision `daa72c51243991dfcaf9f9137d2c573d8f7790c0`, with the native
768 dimensions and `q8` text weights. This is **EmbeddingGemma 2**. The first
EmbeddingGemma generation is not the bundle default.

The [Google model card](https://huggingface.co/google/embeddinggemma-2)
describes a 270M parameter text component in the 740M parameter multimodal
model. Sass needs text search. The loader sets `vision_config` and `audio_config`
to `null` before it creates the model. It reads the model's projected,
normalized `sentence_embedding` output. It uses `task: search result | query: `
for searches and `title: none | text: ` for stored documents. It caps the whole
prefixed input at 8,192 tokens. It does not load vision or audio weights.

The five pinned files total **346,397,233 bytes** before compression. The text
graph and its external weights account for **314,220,093 bytes**. The remainder
contains the tokenizer and configuration. This is an upstream file total, not a
measured release archive size. Configuration hashes came from the two small
files at the pinned revision. Weight and tokenizer hashes and sizes came from
[Hub file metadata](https://huggingface.co/api/models/onnx-community/embeddinggemma-2-ONNX?blobs=true).
The model files are not stored in source control. Retrieval quality and resource use vary by hardware and workload.

The model cache uses this layout:

```text
models/onnx-community/embeddinggemma-2-ONNX/
  daa72c51243991dfcaf9f9137d2c573d8f7790c0/
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/model_quantized.onnx
    onnx/model_quantized.onnx_data
```

Google’s [EmbeddingGemma page](https://ai.google.dev/gemma/docs/embeddinggemma)
states that EmbeddingGemma 2 is licensed under Apache 2.0. The [Google model
card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2) also says
deployments must adhere to the Gemma Prohibited Use Policy. The [Hugging Face
Google model card](https://huggingface.co/google/embeddinggemma-2)
and [ONNX conversion card](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX)
list Apache License 2.0. The [pinned conversion card](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/blob/daa72c51243991dfcaf9f9137d2c573d8f7790c0/README.md)
also contains the policy statement in its Ethics & Safety section. Neither repository lists a standalone LICENSE or
NOTICE file at the checked revisions. The release inputs preserve both upstream
statements, the complete Apache 2.0 text and source links; they do not substitute
a different agreement or omit the policy reference. Preserve applicable
upstream attribution and notices.

Required files under `licenses/`:

- `NODE-LICENSE`: the complete license from the verified official archive;
  the builder copies this file.
- `APACHE-2.0.txt`: the complete [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- `MODEL-TERMS.txt`: the model license notice in `release/MODEL-TERMS.txt`.
- `NOTICE`: applicable model attribution and upstream notices. State that the
  model comes from Google DeepMind and the ONNX conversion from ONNX Community.
- `THIRD-PARTY-NOTICES.txt`: the actual dependency, native library, font, and
  artwork license and notice collection.

The builder copies only these license input files and the official Node
license. It does not carry obsolete model agreements from an input directory.

The validator checks presence and content hashes; it cannot establish legal completeness from a filename. Include applicable native source materials and notices alongside any distributed bundle.

## Installation contract

The archive has flat `dist/`, `node_modules/`, `assets/`, `scripts/`, `runtime/`,
`models/`, and `licenses/` directories. Root files are `package.json`, `LICENSE`,
and `bundle-manifest.json`. It contains no `.env`, database data, or Git checkout.
Run this check before activation, after the bootstrap has checked the external
archive checksum and safe archive paths:

```sh
./runtime/bin/node ./scripts/validate-bundle.mjs .
```

The launcher runs the built entry points with `runtime/bin/node`. Memory uses an
explicit configured cache first. A new bundle uses its included `models/`
directory. A selected model in the old home cache remains usable. Normal setup,
normal runtime, and doctor do not download model files or change models after
failure. An existing explicit model remains selected. A source developer uses
the explicit preparation prompt in source setup or `sass settings`. Only that
consented operation enables downloads; it then checks that the same cache loads
offline. The old environment download flag does not enable runtime downloads.

The ordinary route is currently Mac-only. Source installations and server
hosting use the deployment contract. Do not advertise a platform bundle until
its artifact exists and passes its tests.

Existing explicit Gemma 1 and MiniLM selections retain their own cache and
unprefixed encoding. New Gemma 2 vectors have a separate fingerprint that
includes the model revision, text modality, q8 precision, dimension, and prefix
contract. An update must not relabel or erase old stored vectors. A model change
requires an explicit re-embedding decision before old memories can use the new
vector space.

## Native library isolation

`canvas` uses Cairo and its bundled dependencies. Transformers.js imports sharp
and its separate native dependencies. Loading both stacks into one macOS
process can register the same Objective-C class twice. Deleting a `.dylib` from
an installation is not a supported fix.

Sass loads Transformers.js only in a separate Node process created with
[`child_process.fork`](https://nodejs.org/docs/latest-v24.x/api/child_process.html#child_processforkmodulepath-args-options).
The bot retains canvas. A worker thread shares the process and does not provide
this isolation. The child receives only the model settings and basic system
environment. Chat and Discord credentials are not forwarded. Requests have a
queue bound and timeout. Shutdown closes the child, with a force-stop limit.
The builder rejects duplicate-class warnings during its combined canvas and
local-memory smoke check. Verify rendered ship images, startup, restart, and shutdown against the actual artifacts.
