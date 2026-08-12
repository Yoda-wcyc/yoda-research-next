import { neon } from '@neondatabase/serverless';

// Neon Postgres 連線（DATABASE_URL 由 Vercel 連接 Neon 時自動注入）。
export const sql = neon(process.env.DATABASE_URL);
