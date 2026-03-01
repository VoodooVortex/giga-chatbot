#!/usr/bin/env tsx
/**
 * Manual RAG Sync Script - Syncs ALL tables
 * Run: npx tsx scripts/sync-rag-manual.ts
 */

import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY_EMBEDDING || "");

async function generateEmbedding(text: string): Promise<number[]> {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

async function upsertEmbedding(
    client: any,
    table: string,
    pk: string,
    content: string,
    embedding: number[],
    updatedAt: Date
) {
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
        [table, pk, content, JSON.stringify(embedding), updatedAt]
    );
}

// Sync devices
async function syncDevices() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT de_id, de_name, de_description, de_location, de_serial_number, de_max_borrow_days, updated_at
            FROM devices WHERE de_is_active = true
        `);

        console.log(`📦 Syncing ${result.rows.length} devices...`);

        for (const row of result.rows) {
            const parts: string[] = [`Device: ${row.de_name || ""}`];
            if (row.de_serial_number) parts.push(`Serial: ${row.de_serial_number}`);
            if (row.de_description) parts.push(`Description: ${row.de_description}`);
            if (row.de_location) parts.push(`Location: ${row.de_location}`);
            if (row.de_max_borrow_days) parts.push(`Max Borrow Days: ${row.de_max_borrow_days}`);
            const content = parts.join("\n");

            try {
                const embedding = await generateEmbedding(content);
                await upsertEmbedding(client, "devices", row.de_id.toString(), content, embedding, row.updated_at);
                console.log(`  ✓ ${row.de_name}`);
            } catch (err) {
                console.error(`  ✗ Device ${row.de_id} failed:`, err);
            }
        }
    } finally {
        client.release();
    }
}

// Sync device_childs
async function syncDeviceChilds() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT dec_id, dec_asset_code, dec_serial_number, dec_status, updated_at
            FROM device_childs WHERE dec_is_active = true
        `);

        console.log(`📱 Syncing ${result.rows.length} device childs...`);

        for (const row of result.rows) {
            const parts: string[] = [`Asset Code: ${row.dec_asset_code || ""}`];
            if (row.dec_serial_number) parts.push(`Serial: ${row.dec_serial_number}`);
            if (row.dec_status) parts.push(`Status: ${row.dec_status}`);
            const content = parts.join("\n");

            try {
                const embedding = await generateEmbedding(content);
                await upsertEmbedding(client, "device_childs", row.dec_id.toString(), content, embedding, row.updated_at);
                console.log(`  ✓ ${row.dec_asset_code}`);
            } catch (err) {
                console.error(`  ✗ DeviceChild ${row.dec_id} failed:`, err);
            }
        }
    } finally {
        client.release();
    }
}

// Sync categories
async function syncCategories() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT ca_id, ca_name, updated_at FROM categories WHERE ca_is_active = true
        `);

        console.log(`📂 Syncing ${result.rows.length} categories...`);

        for (const row of result.rows) {
            const content = `Category: ${row.ca_name || ""}`;

            try {
                const embedding = await generateEmbedding(content);
                await upsertEmbedding(client, "categories", row.ca_id.toString(), content, embedding, row.updated_at);
                console.log(`  ✓ ${row.ca_name}`);
            } catch (err) {
                console.error(`  ✗ Category ${row.ca_id} failed:`, err);
            }
        }
    } finally {
        client.release();
    }
}

// Sync borrow_return_tickets
async function syncTickets() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT brt_id, brt_status, brt_user, brt_borrow_purpose, brt_usage_location, brt_reject_reason, updated_at
            FROM borrow_return_tickets
        `);

        console.log(`🎫 Syncing ${result.rows.length} tickets...`);

        for (const row of result.rows) {
            const parts: string[] = ["Borrow Request"];
            if (row.brt_user) parts.push(`User: ${row.brt_user}`);
            if (row.brt_status) parts.push(`Status: ${row.brt_status}`);
            if (row.brt_borrow_purpose) parts.push(`Purpose: ${row.brt_borrow_purpose}`);
            if (row.brt_usage_location) parts.push(`Location: ${row.brt_usage_location}`);
            if (row.brt_reject_reason) parts.push(`Reject Reason: ${row.brt_reject_reason}`);
            const content = parts.join("\n");

            try {
                const embedding = await generateEmbedding(content);
                await upsertEmbedding(client, "borrow_return_tickets", row.brt_id.toString(), content, embedding, row.updated_at);
                console.log(`  ✓ Ticket ${row.brt_id}`);
            } catch (err) {
                console.error(`  ✗ Ticket ${row.brt_id} failed:`, err);
            }
        }
    } finally {
        client.release();
    }
}

// Sync ticket_issues
async function syncIssues() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT ti_id, ti_title, ti_description, ti_status, ti_result, ti_resolved_note, updated_at
            FROM ticket_issues
        `);

        console.log(`🔧 Syncing ${result.rows.length} issues...`);

        for (const row of result.rows) {
            const parts: string[] = [`Issue: ${row.ti_title || ""}`];
            if (row.ti_description) parts.push(`Description: ${row.ti_description}`);
            if (row.ti_status) parts.push(`Status: ${row.ti_status}`);
            if (row.ti_result) parts.push(`Result: ${row.ti_result}`);
            if (row.ti_resolved_note) parts.push(`Resolution: ${row.ti_resolved_note}`);
            const content = parts.join("\n");

            try {
                const embedding = await generateEmbedding(content);
                await upsertEmbedding(client, "ticket_issues", row.ti_id.toString(), content, embedding, row.updated_at);
                console.log(`  ✓ ${row.ti_title}`);
            } catch (err) {
                console.error(`  ✗ Issue ${row.ti_id} failed:`, err);
            }
        }
    } finally {
        client.release();
    }
}

async function main() {
    console.log("🚀 Starting full RAG sync...\n");
    const start = Date.now();

    try {
        await syncDevices();
        await syncDeviceChilds();
        await syncCategories();
        await syncTickets();
        await syncIssues();

        const duration = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`\n✅ Sync completed in ${duration}s!`);
    } catch (err) {
        console.error("\n❌ Sync failed:", err);
    } finally {
        await pool.end();
    }
}

main();
