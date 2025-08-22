#!/bin/bash

# Script para verificar que no se cometan secretos accidentalmente

echo "🔍 Checking for potential secrets in staged files..."

# Patrones a buscar
PATTERNS=(
    "sk-proj-"  # OpenAI API keys
    "sk-"       # General API keys
    "AKIA"      # AWS Access Keys
    "aws_access_key"
    "aws_secret_key"
    "api_key"
    "apikey"
    "password:"
    "passwd:"
    "pwd:"
    "secret:"
    "private_key"
    "client_secret"
    "token:"
)

# Verificar archivos staged
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    echo "✅ No staged files to check"
    exit 0
fi

FOUND_SECRETS=0

for FILE in $STAGED_FILES; do
    # Omitir archivos binarios y de configuración segura
    if [[ "$FILE" == *.png ]] || [[ "$FILE" == *.jpg ]] || [[ "$FILE" == *.pdf ]] || [[ "$FILE" == *.example ]]; then
        continue
    fi
    
    # Verificar cada patrón
    for PATTERN in "${PATTERNS[@]}"; do
        if git diff --cached --no-ext-diff "$FILE" | grep -i "$PATTERN" > /dev/null; then
            echo "⚠️  Potential secret found in $FILE (pattern: $PATTERN)"
            FOUND_SECRETS=1
        fi
    done
done

if [ $FOUND_SECRETS -eq 1 ]; then
    echo ""
    echo "❌ COMMIT BLOCKED: Potential secrets detected!"
    echo ""
    echo "Please remove sensitive data before committing."
    echo "Use environment variables instead:"
    echo "  - Store in .env file"
    echo "  - Access with process.env.VARIABLE_NAME"
    echo ""
    echo "To bypass this check (NOT RECOMMENDED):"
    echo "  git commit --no-verify"
    echo ""
    exit 1
fi

echo "✅ No secrets detected in staged files"
exit 0