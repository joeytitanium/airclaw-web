import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

// Allow build to succeed without DATABASE_URL
// Runtime will fail if DATABASE_URL is not set
const client = connectionString ? postgres(connectionString) : null;

// Create drizzle instance (will throw at runtime if client is null)
export const db = drizzle({
  client: client as ReturnType<typeof postgres>,
  schema,
});
