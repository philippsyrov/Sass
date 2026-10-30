# Bundled local PostgreSQL

The macOS arm64 candidate uses PostgreSQL 18.4 built from official source,
not the EnterpriseDB/Zonky native payload normally installed by the npm wrapper.
The wrapper's TypeScript/JavaScript is unchanged. This local-only build avoids
redistributing the supplier's additional native libraries. Source/server npm
installations keep their existing package behavior.

Source: https://ftp.postgresql.org/pub/source/v18.4/postgresql-18.4.tar.bz2

SHA-256: `81a81ec695fb0c7901407defaa1d2f7973617154cf27ba74e3a7ab8e64436094`

On an arm64 build Mac with Xcode command-line tools and Python 3, verify that
checksum before extracting. Use an empty isolated source/build folder, never
an installed Sass directory. From the extracted source root:

```sh
export MACOSX_DEPLOYMENT_TARGET=13.5
CFLAGS='-O2 -Werror=unguarded-availability-new' ./configure \
  --prefix=/opt/sass/postgresql --without-icu --without-readline \
  --without-zlib --disable-nls --without-gssapi --without-libxml \
  --without-lz4 --without-zstd
make -j2
make DESTDIR="$SASS_PG_STAGE" install
python3 /path/to/release/postgres/relocate.py "$SASS_PG_STAGE/opt/sass/postgresql"
```

Set `SASS_PG_STAGE` to a new private staging folder before running `make install`;
`DESTDIR` keeps the generic prefix out of the global filesystem. SSL is not
enabled. The runtime is for the local loopback database, not a general hosted
PostgreSQL service. The normal Sass schema does not require the disabled
optional components.

The relocation script rewrites the rebuilt runtime's own library references to
relative `@loader_path` paths and ad-hoc signs changed binaries. It does not
remove quarantine or change Gatekeeper. Include the source archive, PostgreSQL
COPYRIGHT, this recipe and the script in the corresponding source materials.

Copy the relocated runtime into the clean staging app's
`node_modules/@embedded-postgres/darwin-arm64/native/`. Remove development-only
`include/` and `lib/pgxs/` from that staging copy. Do not modify an installed app.
Audit all Mach-O dependencies and deployment targets; reject personal build
paths. Run the actual Sass schema/start/query/restart/stop tests against a
synthetic database, then the release builder's offline/native smoke tests.
The full bundle requires macOS 15 because of its Canvas libraries, even though
this PostgreSQL build targets 13.5. Testing on a newer build Mac does not prove
compatibility on the oldest supported OS.
