# Security Policy

## 🔐 Credential Management

### NEVER commit these to the repository:
- API keys (OpenAI, AWS, etc.)
- Database passwords
- JWT secrets
- Any authentication tokens
- Private keys or certificates

### Best Practices:

1. **Use Environment Variables**
   - Store all sensitive data in `.env` file
   - Never commit `.env` file
   - Use `.env.example` as template

2. **Before Every Commit**
   - Review changes for sensitive data
   - Check for hardcoded credentials
   - Use `git diff` to inspect changes

3. **Test Files**
   - Always use `process.env.VARIABLE_NAME`
   - Never hardcode API keys, even for testing
   - Document required environment variables

4. **Configuration Files**
   - Use environment variables in all configs
   - Provide `.example` files for templates

## 🛡️ GitHub Protection

GitHub has secret scanning enabled. If you accidentally push secrets:
1. The push will be blocked
2. Immediately rotate the exposed credential
3. Remove from commit history using `git rebase` or `git filter-branch`

## 📝 Checklist Before Commit

- [ ] No API keys in code
- [ ] No passwords in code  
- [ ] No database credentials
- [ ] Environment variables used for sensitive data
- [ ] `.env` file is in `.gitignore`
- [ ] Test files use environment variables

## 🚨 If Credentials Are Exposed

1. **Immediately rotate the credential**
2. **Remove from repository**
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch PATH_TO_FILE" \
     --prune-empty --tag-name-filter cat -- --all
   ```
3. **Force push to remote**
   ```bash
   git push origin --force --all
   ```
4. **Notify team members**

## 📚 Resources

- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [Managing Secrets in Node.js](https://www.npmjs.com/package/dotenv)
- [Git Filter Branch](https://git-scm.com/docs/git-filter-branch)