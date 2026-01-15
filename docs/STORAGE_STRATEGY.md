# Optimized Git Storage Strategy for Gitflare

## Executive Summary

This document outlines a new storage architecture for Gitflare that addresses the current limitations of storing all git data in Durable Objects SQLite. The proposed hybrid approach uses:

1. **R2** for large blob storage (packfiles, loose objects)
2. **DO SQLite** for metadata, refs, and object index
3. **Content-addressable object storage** instead of filesystem emulation

## Current Implementation Analysis

### How it Works Today

```
Durable Object (per repository)
└── SQLite via DOFS (Durable Object File System)
    └── Virtual filesystem with 512KB chunks
        └── /repo/
            ├── HEAD
            ├── config
            ├── objects/pack/*.pack (chunked into SQLite rows)
            ├── objects/pack/*.idx
            └── refs/
```

### Problems with Current Approach

| Problem | Impact |
|---------|--------|
| 512KB chunked writes | 10MB packfile = 20 writes = $20 per 1M pushes |
| Reading full packfile to extract one object | 10MB packfile = 20 reads, even for 1KB object |
| DO SQLite 10GB limit | Cannot host git/git (65GB+) or similar large repos |
| Row write cost: $1.00/million | Expensive for write-heavy operations |
| Memory limit: 128MB | Cannot process large packfiles in memory |

### Cost Comparison (Current vs Proposed)

For a 10MB packfile push (20 chunks at 512KB):
- **Current**: 20 row writes = $0.00002 per push
- **At scale (1M pushes)**: $20 just for chunk writes

For reading a single 50KB object from that packfile:
- **Current**: Must read all 20 chunks = 20 row reads
- **Proposed**: 1 R2 read + 1 index lookup

## Platform Limits Reference

### Durable Objects SQLite
- Max database size: 10GB per object
- Max row size: 2MB
- Row reads: $0.001/million (after 25B free)
- Row writes: $1.00/million (after 50M free)
- Storage: $0.20/GB-month

### Cloudflare R2
- Max object size: 5TiB
- Single PUT max: 5GiB
- Storage: $0.015/GB-month (7.5x cheaper than DO)
- Class A (writes): $4.50/million
- Class B (reads): $0.36/million
- Egress: FREE

### Workers
- Memory: 128MB per request
- CPU: 30s default, up to 5min
- Response streaming: Supported

## Proposed Architecture

### Storage Tier Separation

```
┌─────────────────────────────────────────────────────────────────┐
│                    Durable Object (per repo)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    SQLite Database                         │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │  │
│  │  │    refs     │ │   objects   │ │      packfiles      │  │  │
│  │  │  (branches, │ │   (index)   │ │    (metadata)       │  │  │
│  │  │    tags)    │ │             │ │                     │  │  │
│  │  ├─────────────┤ ├─────────────┤ ├─────────────────────┤  │  │
│  │  │ name        │ │ oid (PK)    │ │ pack_id (PK)        │  │  │
│  │  │ target_oid  │ │ type        │ │ object_count        │  │  │
│  │  │ symbolic    │ │ size        │ │ total_size          │  │  │
│  │  │             │ │ storage_type│ │ created_at          │  │  │
│  │  │             │ │ pack_id     │ │                     │  │  │
│  │  │             │ │ pack_offset │ │                     │  │  │
│  │  │             │ │ r2_key      │ │                     │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ R2 keys reference
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         R2 Bucket                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ {owner}/{repo}/packs/{pack_id}.pack                         ││
│  │ {owner}/{repo}/objects/{oid[0:2]}/{oid[2:4]}/{oid}          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
-- refs: Branch and tag references (small, frequently accessed)
CREATE TABLE refs (
    name TEXT PRIMARY KEY,      -- e.g., 'refs/heads/main'
    target_oid TEXT NOT NULL,   -- 40-char hex SHA
    symbolic_target TEXT,       -- For symbolic refs like HEAD
    updated_at INTEGER NOT NULL
);

-- objects: Index of all git objects with location info
CREATE TABLE objects (
    oid TEXT PRIMARY KEY,           -- 40-char hex SHA
    type TEXT NOT NULL,             -- 'commit', 'tree', 'blob', 'tag'
    size INTEGER NOT NULL,          -- Uncompressed size
    storage_type TEXT NOT NULL,     -- 'inline', 'r2_loose', 'r2_pack'

    -- For inline storage (small objects < 64KB stored directly)
    data BLOB,

    -- For R2 loose objects
    r2_key TEXT,

    -- For packfile objects
    pack_id TEXT,
    pack_offset INTEGER,
    pack_size INTEGER,              -- Compressed size in pack

    -- Indexes
    FOREIGN KEY (pack_id) REFERENCES packfiles(pack_id)
);

CREATE INDEX idx_objects_pack ON objects(pack_id) WHERE pack_id IS NOT NULL;
CREATE INDEX idx_objects_type ON objects(type);

-- packfiles: Metadata about stored packfiles
CREATE TABLE packfiles (
    pack_id TEXT PRIMARY KEY,       -- UUID or timestamp-based ID
    r2_key TEXT NOT NULL,           -- R2 object key
    object_count INTEGER NOT NULL,
    total_size INTEGER NOT NULL,    -- Size in bytes
    created_at INTEGER NOT NULL,
    gc_status TEXT DEFAULT 'active' -- 'active', 'pending_gc', 'deleted'
);

-- Small frequently-accessed data (config, HEAD)
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Storage Decision Logic

```typescript
const STORAGE_THRESHOLDS = {
  INLINE_MAX: 64 * 1024,        // 64KB - store in SQLite
  SMALL_OBJECT_MAX: 1024 * 1024, // 1MB - store as loose R2 object
  // Above 1MB: always in packfiles
};

function determineStorageType(object: GitObject): StorageType {
  if (object.size <= STORAGE_THRESHOLDS.INLINE_MAX) {
    // Small objects: store inline in SQLite
    // Cost: 1 row write, instant reads
    return 'inline';
  }

  if (object.type === 'blob' && object.size > STORAGE_THRESHOLDS.SMALL_OBJECT_MAX) {
    // Large blobs: store as loose R2 objects for direct streaming
    return 'r2_loose';
  }

  // Default: packfile storage
  return 'r2_pack';
}
```

## Implementation Strategy

### Phase 1: Object Index Layer

Replace DOFS virtual filesystem with direct object storage:

```typescript
class ObjectStore {
  private sql: SqlStorage;
  private r2: R2Bucket;

  async readObject(oid: string): Promise<GitObject> {
    // 1. Look up in index
    const entry = this.sql.exec(
      'SELECT * FROM objects WHERE oid = ?', oid
    ).one();

    if (!entry) throw new NotFoundError(oid);

    // 2. Retrieve based on storage type
    switch (entry.storage_type) {
      case 'inline':
        return { type: entry.type, data: entry.data };

      case 'r2_loose':
        const obj = await this.r2.get(entry.r2_key);
        return { type: entry.type, data: await obj.arrayBuffer() };

      case 'r2_pack':
        return this.readFromPack(entry.pack_id, entry.pack_offset, entry.pack_size);
    }
  }

  async writeObject(oid: string, type: string, data: Uint8Array): Promise<void> {
    const storageType = determineStorageType({ type, size: data.length });

    if (storageType === 'inline') {
      this.sql.exec(
        `INSERT OR REPLACE INTO objects (oid, type, size, storage_type, data)
         VALUES (?, ?, ?, 'inline', ?)`,
        oid, type, data.length, data
      );
    } else if (storageType === 'r2_loose') {
      const key = this.getLooseObjectKey(oid);
      await this.r2.put(key, data);
      this.sql.exec(
        `INSERT OR REPLACE INTO objects (oid, type, size, storage_type, r2_key)
         VALUES (?, ?, ?, 'r2_loose', ?)`,
        oid, type, data.length, key
      );
    }
  }
}
```

### Phase 2: Packfile Processing

On push, process packfiles and index individual objects:

```typescript
async receivePack(packfileData: Uint8Array): Promise<void> {
  // 1. Store packfile in R2 immediately (streaming if large)
  const packId = crypto.randomUUID();
  const r2Key = `${this.repoPath}/packs/${packId}.pack`;
  await this.r2.put(r2Key, packfileData);

  // 2. Index packfile to get object offsets
  const index = await this.indexPackfile(packfileData);

  // 3. Record packfile metadata
  this.sql.exec(
    `INSERT INTO packfiles (pack_id, r2_key, object_count, total_size, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    packId, r2Key, index.objects.length, packfileData.length, Date.now()
  );

  // 4. Index individual objects
  for (const obj of index.objects) {
    this.sql.exec(
      `INSERT OR IGNORE INTO objects
       (oid, type, size, storage_type, pack_id, pack_offset, pack_size)
       VALUES (?, ?, ?, 'r2_pack', ?, ?, ?)`,
      obj.oid, obj.type, obj.size, packId, obj.offset, obj.compressedSize
    );
  }
}
```

### Phase 3: Efficient Pack Reading with Range Requests

Read individual objects from packfiles without loading entire pack:

```typescript
async readFromPack(packId: string, offset: number, size: number): Promise<Uint8Array> {
  const pack = this.sql.exec(
    'SELECT r2_key FROM packfiles WHERE pack_id = ?', packId
  ).one();

  // Use R2 range request to read only the bytes we need
  const response = await this.r2.get(pack.r2_key, {
    range: { offset, length: size + 1024 } // Extra bytes for decompression header
  });

  const compressedData = await response.arrayBuffer();
  return this.decompressObject(new Uint8Array(compressedData));
}
```

### Phase 4: Streaming Large Objects

For clone/fetch operations with large repos:

```typescript
async uploadPack(wants: string[], haves: string[]): Promise<ReadableStream> {
  const objectsToSend = await this.collectObjectsForPack(wants, haves);

  // Stream packfile generation to avoid memory limits
  return new ReadableStream({
    async start(controller) {
      // Write packfile header
      controller.enqueue(packHeader(objectsToSend.length));

      // Stream each object
      for (const oid of objectsToSend) {
        const obj = await this.readObject(oid);
        const packed = packObject(obj);
        controller.enqueue(packed);
      }

      // Write packfile trailer (SHA)
      controller.enqueue(packTrailer());
      controller.close();
    }
  });
}
```

## Cost Analysis

### Scenario: git/git-sized repository (65GB)

**Storage Costs (Monthly)**
| Storage Type | Current (DO SQLite) | Proposed (Hybrid) |
|--------------|---------------------|-------------------|
| 65GB data    | $13.00/month        | $0.98/month (R2)  |
| Index (~1GB) | -                   | $0.20/month (DO)  |
| **Total**    | $13.00/month        | **$1.18/month**   |

**Write Costs (per 10MB push)**
| Operation | Current | Proposed |
|-----------|---------|----------|
| Packfile write | 20 row writes ($0.00002) | 1 R2 put ($0.0000045) |
| Index writes | - | ~100 row writes ($0.0001) |
| **Total** | $0.00002 | **$0.000105** |

Note: Proposed has slightly higher write cost but dramatically reduces read costs and enables unlimited repo sizes.

**Read Costs (fetch single 50KB object)**
| Operation | Current | Proposed |
|-----------|---------|----------|
| Packfile read | 20 row reads | 1 index lookup + 1 R2 range read |
| **Cost** | Negligible | **Negligible** |
| **Latency** | High (20 reads) | **Low (2 reads)** |

## Migration Plan

### Phase 1: New Schema (Week 1)
1. Add new SQLite tables alongside DOFS
2. Keep existing DOFS for backward compatibility

### Phase 2: Dual-Write (Week 2)
1. Write to both old and new systems
2. Validate data consistency

### Phase 3: Read Migration (Week 3)
1. Read from new system first, fall back to old
2. Lazy-migrate objects on read

### Phase 4: Cleanup (Week 4)
1. Remove DOFS dependency
2. Clean up old chunked data

## Alternative Approaches Considered

### Option A: Pure R2 (Rejected)
- **Pros**: Simplest, cheapest storage
- **Cons**: No transactions, eventual consistency issues with refs

### Option B: Pure DO SQLite with better chunking (Rejected)
- **Pros**: Simpler architecture, single data source
- **Cons**: 10GB limit, expensive writes, can't stream

### Option C: D1 for metadata + R2 for objects (Rejected)
- **Pros**: Global metadata replication
- **Cons**: Latency for writes, complexity of cross-service transactions

### Option D: Hybrid DO SQLite + R2 (Selected)
- **Pros**:
  - Best of both worlds
  - Transactional consistency for refs
  - Unlimited storage via R2
  - Efficient single-object reads
  - Supports streaming
- **Cons**:
  - More complex implementation
  - Two systems to maintain

## Handling Large Repositories

### git/git Repository Profile
- Commits: 723K (~525MB)
- Trees: 3.4M (~9GB)
- Blobs: 1.65M (~56GB)
- Total: ~65GB

### Storage Distribution (Proposed)
| Data Type | Storage Location | Estimated Size |
|-----------|-----------------|----------------|
| Refs | DO SQLite inline | ~10KB |
| Commits | DO SQLite inline | ~500MB |
| Small trees (<64KB) | DO SQLite inline | ~2GB |
| Large trees | R2 loose/pack | ~7GB |
| Small blobs (<64KB) | DO SQLite inline | ~1GB |
| Large blobs | R2 loose/pack | ~55GB |
| Object index | DO SQLite | ~200MB |
| **DO Total** | | **~3.7GB** (under 10GB limit) |
| **R2 Total** | | **~62GB** |

## API Changes

### GitService Updates

```typescript
class GitService {
  // Replace DOFS-based fs with ObjectStore
  constructor(
    private objectStore: ObjectStore,
    private repoPath: string
  ) {}

  // Read operations use index
  async readObject(oid: string): Promise<GitObject> {
    return this.objectStore.readObject(oid);
  }

  // Write operations go through ObjectStore
  async writeObject(type: string, data: Uint8Array): Promise<string> {
    const oid = computeOid(type, data);
    await this.objectStore.writeObject(oid, type, data);
    return oid;
  }
}
```

## Conclusion

The proposed hybrid architecture solves all current limitations:

1. **Unlimited repository size**: R2 can store petabytes
2. **Efficient single-object reads**: Index lookup + range request
3. **Cost-effective**: 10x cheaper storage with R2
4. **Maintains consistency**: Refs stay in transactional DO SQLite
5. **Supports streaming**: Large packfiles don't hit memory limits

This approach is modeled after how GitHub and GitLab handle large repositories: metadata in a database, objects in object storage, with an index mapping OIDs to locations.

## References

- [Cloudflare Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare R2 Limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Platform Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub git-sizer](https://github.com/github/git-sizer)
- [GitHub Repository Limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
