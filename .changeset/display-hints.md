---
"@authloop-ai/core": patch
"@authloop-ai/mcp": patch
"@authloop-ai/openclaw-authloop": patch
---

Add server TTL-based timeout to waitForStatus so it never blocks forever. Replace QR ASCII generation with display hints — agent/channel handles QR rendering natively. Remove qrcode dependency.
