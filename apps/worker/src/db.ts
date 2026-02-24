import { Pool, PoolClient } from "pg";
import { env } from "./config";
import type { RecordData } from "./types";

// Create connection pool for worker
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Handle pool errors
pool.on("error", (err) => {
    console.error("Unexpected database pool error:", err);
    process.exit(-1);
});

/**
 * Get a client from the pool for LISTEN/NOTIFY
 */
export async function getListenClient(): Promise<PoolClient> {
    const client = await pool.connect();
    return client;
}

/**
 * Fetch record data from the source table
 */
export async function fetchRecordData(
    table: string,
    pk: string
): Promise<RecordData | null> {
    const client = await pool.connect();
    try {
        // Build query based on table
        let query: string;
        let params: (string | number)[] = [pk];

        switch (table) {
            case "devices":
                query = `
          SELECT 
            de_id as pk,
            de_name as name,
            de_description as description,
            de_location as location,
            de_serial_number as serial,
            de_max_borrow_days as max_borrow_days,
            updated_at
          FROM devices WHERE de_id = $1
        `;
                params = [parseInt(pk, 10)];
                break;

            case "device_childs":
                query = `
          SELECT 
            dec_id as pk,
            dec_asset_code as asset_code,
            dec_serial_number as serial,
            dec_status as status,
            updated_at
          FROM device_childs WHERE dec_id = $1
        `;
                params = [parseInt(pk, 10)];
                break;

            case "categories":
                query = `
          SELECT 
            ca_id as pk,
            ca_name as name,
            updated_at
          FROM categories WHERE ca_id = $1
        `;
                params = [parseInt(pk, 10)];
                break;

            case "borrow_return_tickets":
                query = `
          SELECT 
            brt_id as pk,
            brt_status as status,
            brt_user as user_name,
            brt_borrow_purpose as purpose,
            brt_usage_location as location,
            brt_reject_reason as reject_reason,
            updated_at
          FROM borrow_return_tickets WHERE brt_id = $1
        `;
                params = [parseInt(pk, 10)];
                break;

            case "ticket_issues":
                query = `
          SELECT 
            ti_id as pk,
            ti_title as title,
            ti_description as description,
            ti_status as status,
            ti_result as result,
            ti_damaged_reason as damaged_reason,
            ti_resolved_note as resolved_note,
            updated_at
          FROM ticket_issues WHERE ti_id = $1
        `;
                params = [parseInt(pk, 10)];
                break;

            default:
                console.warn(`Unknown table: ${table}`);
                return null;
        }

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];

        // Build content string from record data
        const content = buildContentString(table, row);

        return {
            table,
            pk,
            content,
            updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        };
    } finally {
        client.release();
    }
}

/**
 * Build a content string for embedding from record data
 */
function buildContentString(table: string, row: Record<string, unknown>): string {
    const parts: string[] = [];

    switch (table) {
        case "devices":
            parts.push(`Device: ${row.name || ""}`);
            if (row.serial) parts.push(`Serial: ${row.serial}`);
            if (row.description) parts.push(`Description: ${row.description}`);
            if (row.location) parts.push(`Location: ${row.location}`);
            if (row.max_borrow_days) parts.push(`Max Borrow Days: ${row.max_borrow_days}`);
            break;

        case "device_childs":
            parts.push(`Asset Code: ${row.asset_code || ""}`);
            if (row.serial) parts.push(`Serial: ${row.serial}`);
            if (row.status) parts.push(`Status: ${row.status}`);
            break;

        case "categories":
            parts.push(`Category: ${row.name || ""}`);
            break;

        case "borrow_return_tickets":
            parts.push(`Borrow Request`);
            if (row.user_name) parts.push(`User: ${row.user_name}`);
            if (row.status) parts.push(`Status: ${row.status}`);
            if (row.purpose) parts.push(`Purpose: ${row.purpose}`);
            if (row.location) parts.push(`Location: ${row.location}`);
            if (row.reject_reason) parts.push(`Reject Reason: ${row.reject_reason}`);
            break;

        case "ticket_issues":
            parts.push(`Issue: ${row.title || ""}`);
            if (row.description) parts.push(`Description: ${row.description}`);
            if (row.status) parts.push(`Status: ${row.status}`);
            if (row.result) parts.push(`Result: ${row.result}`);
            if (row.resolved_note) parts.push(`Resolution: ${row.resolved_note}`);
            break;

        default:
            parts.push(JSON.stringify(row));
    }

    return parts.join("\n");
}

/**
 * Delete embedding from rag.embeddings
 */
export async function deleteEmbedding(table: string, pk: string): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(
            "DELETE FROM rag.embeddings WHERE re_source_table = $1 AND re_source_pk = $2",
            [table, pk]
        );
        console.log(`Deleted embedding for ${table}:${pk}`);
    } finally {
        client.release();
    }
}

/**
 * Upsert embedding to rag.embeddings
 */
export async function upsertEmbedding(
    sourceTable: string,
    sourcePk: string,
    content: string,
    embedding: number[],
    sourceUpdatedAt: Date
): Promise<void> {
    const client = await pool.connect();
    try {
        // Use INSERT ... ON CONFLICT for upsert
        await client.query(
            `
      INSERT INTO rag.embeddings 
        (re_source_table, re_source_pk, re_content, re_embedding, re_source_updated_at, re_embedded_at)
      VALUES 
        ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (re_source_table, re_source_pk) 
      DO UPDATE SET
        re_content = EXCLUDED.re_content,
        re_embedding = EXCLUDED.re_embedding,
        re_source_updated_at = EXCLUDED.re_source_updated_at,
        re_embedded_at = NOW()
      `,
            [sourceTable, sourcePk, content, JSON.stringify(embedding), sourceUpdatedAt]
        );
        console.log(`Upserted embedding for ${sourceTable}:${sourcePk}`);
    } finally {
        client.release();
    }
}