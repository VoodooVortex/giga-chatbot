import {
    pgTable,
    bigserial,
    varchar,
    text,
    timestamp,
    jsonb,
    uuid,
    index,
    vector,
    integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { env } from "@/lib/config";

// ============================================================================
// Chat Schema
// ============================================================================

export const chatRooms = pgTable(
    "chat_rooms",
    {
        crId: bigserial("cr_id", { mode: "number" }).primaryKey(),
        crTitle: varchar("cr_title", { length: 255 }),
        crUserId: uuid("cr_user_id").notNull(),
        crStatus: varchar("cr_status", { length: 50 }).default("active").notNull(),
        crCreatedAt: timestamp("cr_created_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
        crUpdatedAt: timestamp("cr_updated_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
    },
    (table) => ({
        userIdIdx: index("chat_rooms_user_id_idx").on(table.crUserId),
        statusIdx: index("chat_rooms_status_idx").on(table.crStatus),
        createdAtIdx: index("chat_rooms_created_at_idx").on(table.crCreatedAt),
    })
);

export const chatMessages = pgTable(
    "chat_messages",
    {
        cmId: bigserial("cm_id", { mode: "number" }).primaryKey(),
        cmCrId: bigserial("cm_cr_id", { mode: "number" })
            .references(() => chatRooms.crId, { onDelete: "cascade" })
            .notNull(),
        cmRole: varchar("cm_role", { length: 50 }).notNull(), // user, assistant, system, tool
        cmContent: text("cm_content").notNull(),
        cmToolCalls: jsonb("cm_tool_calls"), // Store tool call data
        cmToolCallId: varchar("cm_tool_call_id", { length: 255 }), // For matching tool responses
        cmCreatedAt: timestamp("cm_created_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
    },
    (table) => ({
        roomIdIdx: index("chat_messages_room_id_idx").on(table.cmCrId),
        createdAtIdx: index("chat_messages_created_at_idx").on(table.cmCreatedAt),
    })
);

export const chatAttachments = pgTable(
    "chat_attachments",
    {
        caId: bigserial("ca_id", { mode: "number" }).primaryKey(),
        caCmId: bigserial("ca_cm_id", { mode: "number" })
            .references(() => chatMessages.cmId, { onDelete: "cascade" })
            .notNull(),
        caFilename: varchar("ca_filename", { length: 255 }).notNull(),
        caMimeType: varchar("ca_mime_type", { length: 100 }).notNull(),
        caFileSize: bigserial("ca_file_size", { mode: "number" }).notNull(),
        caStoragePath: varchar("ca_storage_path", { length: 500 }).notNull(),
        caCreatedAt: timestamp("ca_created_at", { withTimezone: true })
            .default(sql`NOW()`)
            .notNull(),
    },
    (table) => ({
        messageIdIdx: index("chat_attachments_message_id_idx").on(table.caCmId),
    })
);

// ============================================================================
// RAG Schema - Embeddings
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

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;