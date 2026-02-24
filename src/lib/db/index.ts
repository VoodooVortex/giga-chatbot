import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/config";
import * as schema from "./schema";

// Create connection pool
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection not established
});

// Handle pool errors
pool.on("error", (err) => {
    console.error("Unexpected database pool error:", err);
    process.exit(-1);
});

// Create Drizzle ORM instance
export const db = drizzle(pool, { schema });

// Export pool for raw queries if needed
export { pool };

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
    try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        return true;
    } catch (error) {
        console.error("Database health check failed:", error);
        return false;
    }
}