### Delta Resolution

- delta resolution will be done dynamically when isomorphic-git reads the object.
- when `Fs.read` is called for a delta object, we (the fs adapter) will read the object from sqlite table, and then we recursively read its base object until we reach a non-delta object.
- after we have the full base object, we will apply all the deltas on top of it to reconstruct the full object. and cache it in Cache API for future reads.

### Other Important Notes

- We will not advertise "OFS_DELTA" capability, so we only have to support REF_DELTA which has base oid.
