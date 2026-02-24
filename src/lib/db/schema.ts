import {
    pgTable,
    bigserial,
    varchar,
    text,
    timestamp,
    jsonb,
    integer,
    vector,
    index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { env } from "@/lib/config";

// ============================================================================
// Chat Schema (References existing Orbis-Track tables)
// NOTE: These reference existing tables in Orbis-Track database
// ============================================================================

// Chat Rooms Table (existing in Orbis-Track)
export const chatRooms = pgTable("chat_rooms", {
    cr_id: bigserial("cr_id", { mode: "number" }).primaryKey(),
    cr_us_id: integer("cr_us_id").notNull(),
    cr_title: varchar("cr_title", { length: 255 }),
    created_at: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`).notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
    last_msg_at: timestamp("last_msg_at", { withTimezone: true }),
});

// Chat Messages Table (existing in Orbis-Track)
export const chatMessages = pgTable("chat_messages", {
    cm_id: bigserial("cm_id", { mode: "number" }).primaryKey(),
    cm_cr_id: integer("cm_cr_id").notNull(),
    cm_role: varchar("cm_role", { length: 20 }).notNull(),
    cm_content: text("cm_content").notNull(),
    cm_content_json: jsonb("cm_content_json"),
    cm_status: varchar("cm_status", { length: 20 }).notNull().default("ok"),
    cm_parent_id: integer("cm_parent_id"),
    created_at: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`).notNull(),
});

// Chat Attachments Table (existing in Orbis-Track)
export const chatAttachments = pgTable("chat_attachments", {
    catt_id: bigserial("catt_id", { mode: "number" }).primaryKey(),
    catt_cm_id: integer("catt_cm_id").notNull(),
    catt_file_path: varchar("catt_file_path", { length: 500 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`).notNull(),
});

// ============================================================================
// RAG Schema - Embeddings (New table for giga-chatbot)
// ============================================================================

export const embeddings = pgTable(
    "embeddings",
    {
        reId: bigserial("re_id", { mode: "number" }).primaryKey(),
        reSourceTable: varchar("re_source_table", { length: 100 }).notNull(),
        reSourcePk: varchar("re_source_pk", { length: 100 }).notNull(),
        reContent: text("re_content").notNull(),
        reEmbedding: vector("re_embedding", { dimensions: env.EMBEDDING_DIMENSION }),
        reSourceUpdatedAt: timestamp("re_source_updated_at", { withTimezone: true }),
        reEmbeddedAt: timestamp("re_embedded_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
        reCreatedAt: timestamp("re_created_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
    },
    (table) => ({
        // Unique constraint on source table + pk
        sourceUniqueIdx: index("embeddings_source_unique_idx").on(
            table.reSourceTable,
            table.reSourcePk
        ),
        // HNSW index for vector similarity search
        embeddingIdx: index("embeddings_embedding_idx").using(
            "hnsw",
            table.reEmbedding.op("vector_cosine_ops")
        ),
        // Index for filtering by table
        tableIdx: index("embeddings_table_idx").on(table.reSourceTable),
    })
);

// ============================================================================
// Types
// ============================================================================

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;

// Orbis-Track Business Types for RAG
export interface Device {
    de_id: number;
    de_serial_number: string;
    de_name: string;
    de_description: string | null;
    de_location: string;
    de_max_borrow_days: number;
    de_images: string | null;
    de_af_id: number;
    de_ca_id: number;
    de_us_id: number;
    de_sec_id: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface DeviceChild {
    dec_id: number;
    dec_serial_number: string | null;
    dec_asset_code: string;
    dec_has_serial_number: boolean;
    dec_status: "UNAVAILABLE" | "READY" | "BORROWED" | "REPAIRING" | "DAMAGED" | "LOST";
    dec_de_id: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface Category {
    ca_id: number;
    ca_name: string;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface BorrowReturnTicket {
    brt_id: number;
    brt_status: "PENDING" | "APPROVED" | "IN_USE" | "OVERDUE" | "COMPLETED" | "REJECTED";
    brt_user: string;
    brt_phone: string;
    brt_usage_location: string;
    brt_borrow_purpose: string;
    brt_start_date: Date;
    brt_end_date: Date;
    brt_quantity: number;
    brt_current_stage: number | null;
    brt_reject_reason: string | null;
    brt_pickup_location: string | null;
    brt_pickup_datetime: Date | null;
    brt_return_location: string | null;
    brt_return_datetime: Date | null;
    brt_af_id: number | null;
    brt_user_id: number;
    brt_staff_id: number | null;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface TicketIssue {
    ti_id: number;
    ti_de_id: number;
    ti_brt_id: number | null;
    ti_title: string;
    ti_description: string;
    ti_reported_by: number;
    ti_assigned_to: number | null;
    ti_status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
    ti_result: "SUCCESS" | "FAILED" | "IN_PROGRESS";
    ti_damaged_reason: string | null;
    ti_resolved_note: string | null;
    receive_at: Date | null;
    success_at: Date | null;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}