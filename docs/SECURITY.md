# Security review and release gate

**Identity:** Entra single-tenant login through Supabase Auth. Never trust user-supplied email addresses for identity or roles. First-time users get the Requestor role; Admin is seeded using privileged SQL.

**Authorization:** Requests are visible only to owner, assigned Approver or Admin. Review actions and status transitions run through SQL security-definer RPCs that verify actor and allowed transitions. Request table updates are not granted directly to authenticated users. Document access is protected by request-scoped RLS and private Storage policies.

**File handling:** Supported files are limited to PDF, PNG, JPG, TXT, DOCX and XLSX up to 10 MB; download links expire after 60 seconds. Before production, add malware scanning, validation of content signatures, durable deletion/retention procedures and orphan-file cleanup for failed metadata writes.

**Notifications:** Cron endpoint requires a long CRON_SECRET, uses service-role key only on the server, claims a bounded batch and uses provider idempotency keys. Monitor delivery errors and delivery retries.

**Release blockers before production:** Manual RLS negative tests, dependency auditing, Office manifest schema validation, Outlook compatibility testing, managed tenant Conditional Access testing, rate limits, appropriate student record privacy practices, backup and data retention, and recovery safeguards for the final admin account.

The initial Outlook integration operates on the **selected** message. Drafted replies and calendar events are not sent/saved until the user confirms them in Outlook.
