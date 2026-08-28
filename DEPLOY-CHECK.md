# Checklist before going public

1. Supabase SQL -> `supabase/schema.sql`
2. Supabase Storage -> private bucket `chat-media`
3. Render env vars:
   DATABASE_URL
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   APP_SECRET
   STORAGE_BUCKET=chat-media
4. Deploy.
5. Check `/api/health`.
6. Register two test users.
7. Test private message.
8. Test general message.
9. Test image upload + paste.
10. Test audio upload + playback.
11. Test profile photo.
12. Test screen share over the public HTTPS URL.
13. Check Render logs after every media test.

Never expose the service-role key to browser code.
