# Error Handling

```mermaid
flowchart TD
    Code["Any controller or service or middleware"] -->|"throw AppError operational"| CEH
    Code2["Any controller or service or middleware"] -->|"unexpected JS error or DB crash"| CEH

    CEH["centralErrorHandler err req res"]
    CEH --> GenId["requestId = randomUUID()"]
    GenId --> Check{{"err.isOperational?"}}

    Check -- Yes --> WarnLog["logger.warn requestId method url status message"]
    Check -- No  --> ErrLog["logger.error requestId method url status full stack"]

    WarnLog --> SafeMsg["message = err.message safe to expose"]
    ErrLog  --> GenMsg["message = Internal server error stack never sent"]

    SafeMsg --> Send["sendJson res statusCode error message requestId"]
    GenMsg  --> Send

    Send --> Client["Client receives success=false error requestId"]

    style ErrLog fill:#c0392b,color:#fff
    style GenMsg fill:#c0392b,color:#fff
```

**Error catalogue:**

| Status | Thrown when |
|--------|-------------|
| 400 | Malformed JSON, missing required fields, invalid meta, no files in upload |
| 401 | No token/cookie, invalid signature, expired token, wrong token type, refresh reuse |
| 403 | Role too low (`requireRole`), missing scope (`requireScope`) |
| 404 | File not found, share token not in DB, user not found |
| 409 | Username already taken |
| 413 | File exceeds `MAX_FILE_SIZE_BYTES`, too many files per request |
| 415 | File content does not match declared `mimeType` |
| 500 | Unexpected errors (DB crash, disk error, etc.) — stack hidden from client |
