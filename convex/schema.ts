import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.string(),
    // Derived on the server from ADMIN_EMAILS; never accepted from the client.
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned"),
    ),
    returnedAt: v.optional(v.number()),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_tool", ["toolId"])
    .index("by_status", ["status"]),

  // Log of every automation touchpoint so failures are visible, never silent.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: v.string(),
    status: v.union(v.literal("sent"), v.literal("retrying"), v.literal("failed")),
    key: v.string(), // idempotency key, unique per logical event
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_key", ["key"]),
});
