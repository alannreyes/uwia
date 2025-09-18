# Document Consolidado Table Configuration

## Overview
The system now uses `document_consolidado` table exclusively for document configuration, providing a unified approach to managing document prompts and field mappings.

## Environment Variable
```bash
DOCUMENT_PROMPTS_TABLE_NAME=document_consolidado
```

## Table Structure
The `document_consolidado` table contains:
- **document_name**: Document filename (e.g., 'POLICY.pdf')
- **question**: Consolidated prompt for all document fields
- **field_names**: JSON array of expected field names
- **expected_fields_count**: Number of fields to extract
- **pmc_field**: Response field name
- **active**: Enable/disable configuration

## Usage Examples

### Production (default)
```bash
# Uses document_consolidado table
DOCUMENT_PROMPTS_TABLE_NAME=document_consolidado
```

### Testing Environment
```bash
# Uses separate test table
DOCUMENT_PROMPTS_TABLE_NAME=test_document_consolidado
```

### Staging Environment
```bash
# Uses staging table
DOCUMENT_PROMPTS_TABLE_NAME=staging_document_consolidado
```

## Configuration Management

### View Active Configurations
```sql
SELECT document_name, expected_fields_count, active
FROM document_consolidado
WHERE active = true;
```

### Add New Document Configuration
```sql
INSERT INTO document_consolidado (
  document_name,
  question,
  field_names,
  expected_fields_count,
  pmc_field,
  active
) VALUES (
  'NEW_DOCUMENT.pdf',
  'Extract the following fields...',
  '["field1", "field2", "field3"]',
  3,
  'new_document_responses',
  true
);
```

### Update Document Configuration
```sql
UPDATE document_consolidado
SET question = 'Updated prompt...',
    updated_at = NOW()
WHERE document_name = 'POLICY.pdf';
```

## Migration from Legacy System

The system has been fully migrated from the old `document_prompts` table to `document_consolidado`:

- ✅ **Unified Configuration**: Single table for all document types
- ✅ **Consolidated Prompts**: One prompt per document with multiple fields
- ✅ **Better Performance**: Reduced database queries
- ✅ **Simplified Management**: Single point of configuration

## Benefits

1. **Simplified Architecture**: One table instead of multiple prompt entries
2. **Better Performance**: Single query per document instead of multiple
3. **Unified Response Format**: Consistent field extraction across all documents
4. **Easier Maintenance**: Centralized configuration management