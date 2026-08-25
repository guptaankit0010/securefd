# File Module — HLD

> **Legend**
> - 🔴 Red nodes — Security controls
> - 🔵 Blue nodes — Validation / Input checks
> - 🟢 Green nodes — Performance decisions
> - White nodes — Business logic / happy path

---

## Upload

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/files  multipart/form-data]) --> B

    B["requireAuth + requireScope file:write\n— scope checked against JWT claims\n— no DB lookup on every request"]
    B --> C

    C["Busboy multipart parser\n— fileSize limit: MAX_FILE_SIZE_BYTES\n— files limit: MAX_FILES_PER_UPLOAD\n— fields limit: MAX_FILES_PER_UPLOAD\n— streams: never buffers whole file in RAM"]
    C --> D

    D["field event: parse meta JSON\n— filename, mimeType, declaredSize\n— validate SCHEMAS.fileMeta\n— mimeType enum: text/plain or application/json only"]
    D --> E

    E["file event: assertSafePath\n— path.resolve collapses all dot-dot sequences\n— resolved path must start with storageDir + sep\n— blocks directory traversal attacks"]
    E --> F

    F["First chunk: looksLikeText\n— byte-by-byte UTF-8 inspection\n— rejects null bytes 0x00\n— rejects C0 control chars except tab LF CR\n— rejects lone high bytes\n— validates multi-byte UTF-8 sequences\n— detects PDFs, images, EXEs disguised as text"]
    F --> G

    G{content valid?}
    G -- no --> H["failFile AppError 415\n— unpipe fileStream from cipher\n— fileStream.resume() — busboy not stalled\n— cipher.destroy() + dest.destroy()\n— fs.unlink removes partial file\n— other files in same request unaffected"]
    G -- yes --> I

    I["createEncryptStream\n— AES-256-GCM mode\n— randomBytes(12) fresh IV per file\n— cipher is Node.js Transform stream\n— fileStream pipe cipher pipe dest WriteStream"]
    I --> J

    J["dest finish event\n— getAuthTag() after stream finishes\n— authTag validates ciphertext integrity on decrypt"]
    J --> K

    K["insertDoc FileModel\n— owner as ObjectId\n— iv and authTag as Buffer\n— validateDoc type-checks every field\n— timestamps stamped automatically"]
    K --> L["best-effort results\n— 201 all succeeded\n— 207 partial success\n— 400 all failed"]

    class B,D val
    class E,F,H,I,J sec
    class C perf
```

---

## List Files

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([GET /api/files]) --> B

    B["requireAuth + requireScope file:read"]
    B --> C

    C["parsePagination\n— parse ?page and ?limit query params\n— limit clamped to MAX_PAGE_SIZE\n— skip = page-1 * limit\n— no unbounded toArray ever"]
    C --> D

    D{user role?}
    D -- admin --> E["match filter: isDeleted=false\n— sees all non-deleted files"]
    D -- manager/viewer --> F["distinct active share file IDs\n— sharetokens: revoked=false expiresAt gt now\n— then build OR: owner + sharedIds"]

    E --> G
    F --> G

    G["aggregate pipeline\n1. dollar-match  — scoped filter\n2. dollar-sort   — createdAt desc\n3. dollar-skip   — pagination offset\n4. dollar-limit  — page size cap\n5. dollar-lookup — sharetokens per file\n   — pipeline inside lookup\n   — index seek per file, not full scan\n   — limit 1 inside nested pipeline\n6. dollar-addFields — unwrap array to single doc\n7. dollar-project  — exclude iv authTag storageName"]
    G --> H

    H["Promise.all\n— fetchFilesWithShare + countDocuments\n— parallel: two queries, one round-trip cost"]
    H --> I

    I["attachShareUrls\n— per file: HMAC-SHA256 re-sign\n— deterministic: same payload + secret = same token\n— shareUrl expires at exact same time as original token"]
    I --> J["200 files + total + page + limit + pages"]

    class B,C val
    class I sec
    class C,G,H perf
```

---

## Get Single File

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([GET /api/files/:fileId]) --> B

    B["requireAuth + requireScope file:read"]
    B --> C

    C["toObjectId fileId\n— throws AppError 400 on bad format\n— never passes invalid BSON to MongoDB"]
    C --> D

    D["fetchFilesWithShare\n— aggregate: match _id + isDeleted=false\n— dollar-lookup sharetokens inline\n— single DB round-trip for file + share\n— limit 1 inside lookup: no full scan"]
    D --> E

    E{file found?}
    E -- no --> F["AppError 404 File not found"]
    E -- yes --> G

    G{user role admin?}
    G -- yes --> I["admin sees any file"]
    G -- no --> H

    H["check ownership + share access\n— isOwner: raw.owner equals req.user.uid\n— isShared: activeShare exists in lookup result\n— 404 if neither: prevents existence leak\n   attacker cannot tell if file exists at all"]
    H -- access denied --> F
    H -- access granted --> I

    I --> J["attachShareUrls\n— inject shareUrl if active share exists"]
    J --> K["200 file object"]

    class B,C val
    class H,C sec
    class D perf
```

---

## Delete File

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([DELETE /api/files/:fileId]) --> B

    B["requireAuth + requireScope file:delete\n— admin does NOT have file:delete scope\n— only manager/viewer who owns the file\n— scope enforced in ROLE_SCOPES config"]
    B --> C

    C["findOne files\n— filter: _id + owner=req.user.uid + isDeleted=false\n— ownership check: you can only delete your own files\n— 404 if not found or not owner"]
    C --> D

    D["updateOne files\n— set isDeleted=true\n— prepareSet stamps updatedAt\n— blob stays on disk encrypted\n— audit trail preserved in DB"]
    D --> E

    E["updateMany sharetokens\n— filter: file=fileId\n— set revoked=true\n— cascade: all share links for this file immediately dead\n— download attempts return 401"]
    E --> F["200 File deleted"]

    class B,C val
    class B,D,E sec
```
