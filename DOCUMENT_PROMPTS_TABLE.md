# Document Prompts Table Configuration

## Overview
The document prompts table name is now configurable via environment variable, allowing for flexible deployments and testing scenarios.

## Environment Variable
```bash
DOCUMENT_PROMPTS_TABLE_NAME=document_prompts
```

## Default Behavior
- **Default table name**: `document_prompts`
- **Fallback**: If `DOCUMENT_PROMPTS_TABLE_NAME` is not set, the system defaults to `document_prompts`

## Usage Examples

### Production (default)
```bash
# Uses default table
DOCUMENT_PROMPTS_TABLE_NAME=document_prompts
```

### Testing Environment
```bash
# Uses separate test table
DOCUMENT_PROMPTS_TABLE_NAME=test_document_prompts
```

### Staging Environment
```bash
# Uses staging-specific table
DOCUMENT_PROMPTS_TABLE_NAME=staging_document_prompts
```

## Implementation Details
- **Entity**: `DocumentPrompt` entity uses `@Entity(process.env.DOCUMENT_PROMPTS_TABLE_NAME || 'document_prompts')`
- **TypeORM**: Automatically handles table mapping
- **SQL Scripts**: External SQL scripts still reference the default `document_prompts` table

## Migration Notes
- **Backward Compatible**: Existing deployments continue working without changes
- **No Database Changes**: No schema modifications required
- **Service Restart**: Requires application restart to pick up new table name

## Verification
To verify the table name being used:
1. Check application logs during startup
2. Verify database queries are hitting the correct table
3. Ensure TypeORM metadata reflects the correct table name