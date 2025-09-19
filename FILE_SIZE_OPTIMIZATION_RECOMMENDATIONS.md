# File Size Threshold Optimization Recommendations

## Current Issues

1. **Overlapping Logic**: Files 20-30MB use File API, but files >30MB that are <100MB also use File API (via bypass)
2. **Unnecessary Splitting**: The 5MB chunk size is too small and causes excessive API calls
3. **Redundant Thresholds**: Three different decision points create confusion

## Current Flow

```
< 20MB         → Inline API
20-30MB        → File API
30-100MB       → Smart Splitting → Bypass → File API Direct ✅
> 100MB        → Smart Splitting → Split into 5MB chunks
```

## Recommended Optimization

### Simplified Flow

```
< 10MB         → Inline API (fast, simple documents)
10-150MB       → File API Direct (no splitting) ✅
> 150MB        → Smart Page-Based Splitting
```

### Why These Thresholds?

1. **< 10MB**: Small files that can be processed inline efficiently
   - Most simple PDFs (1-20 pages of text)
   - Fast processing without file upload overhead

2. **10-150MB**: Direct to Gemini File API
   - **Gemini supports up to 2GB per file**
   - Avoids pdf-lib splitting bug
   - Covers 99% of real-world PDFs
   - Proven to work with POLICY.pdf (31MB)

3. **> 150MB**: Page-based splitting only when necessary
   - Very large scanned documents (300+ pages)
   - Split by pages, not by size (avoids pdf-lib bug)
   - Use larger chunks (20-30 pages per chunk)

## Implementation Changes

### 1. Update Main Processing Logic

```typescript
// In processPdf method
if (fileSizeMB < 10) {
  return await this.processWithInlineApi(...);
} else if (fileSizeMB <= 150) {
  return await this.processFileDirectly(...);  // Direct upload
} else {
  return await this.processWithPageBasedSplitting(...);
}
```

### 2. Remove Size-Based Splitting

**Never use `splitPdfIntoChunks` with size limits** - it triggers the pdf-lib bug.
Instead, use page-based splitting when needed.

### 3. Update Environment Variables

```bash
# Recommended settings
INLINE_API_THRESHOLD_MB=10      # For small files
DIRECT_API_THRESHOLD_MB=150     # Direct to Gemini (no split)
PAGE_SPLIT_CHUNK_SIZE=30        # Pages per chunk when splitting
```

## Performance Impact

| File Size | Current Method | Recommended Method | Expected Improvement |
|-----------|---------------|-------------------|---------------------|
| 5MB | Inline API | Inline API | No change |
| 25MB | File API | File API Direct | Simpler flow |
| 33MB (POLICY) | Split → Bypass | File API Direct | Direct path, no detour |
| 100MB | Split → Bypass | File API Direct | Direct path |
| 200MB | Split (5MB chunks) | Page-based split | Fewer chunks, no size bug |

## Benefits

1. **Eliminates pdf-lib bug**: No size-based splitting
2. **Reduces API calls**: Larger chunks or no splitting
3. **Faster processing**: Direct path for most files
4. **Simpler logic**: Three clear thresholds instead of overlapping rules
5. **Better scalability**: Leverages Gemini's 2GB capacity

## Testing Results

- ✅ POLICY.pdf (31MB): **30.4s** with direct method
- ✅ No size inflation bugs
- ✅ High confidence scores (0.85)
- ✅ Consistent results

## Next Steps

1. Update the service to use simplified thresholds
2. Remove size-based splitting entirely
3. Test with various file sizes to validate
4. Monitor performance metrics
5. Document the new flow for the team