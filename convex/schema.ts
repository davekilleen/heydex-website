import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  users: defineTable({
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    handle: v.optional(v.string()),
    role: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    title: v.optional(v.string()),
    industry: v.optional(v.string()),
    seniority: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    source: v.optional(v.string()),
    onboardingCompleted: v.optional(v.boolean()),
    marketingOptOut: v.optional(v.boolean()),
    welcomeEmailSent: v.optional(v.boolean()),
    isPublic: v.optional(v.boolean()),
    visibility: v.optional(v.union(
      v.literal("private"),
      v.literal("colleagues"),
      v.literal("public")
    )),
    tokenIdentifier: v.optional(v.string()),
  })
    .index("by_handle", ["handle"])
    .index("by_domain", ["domain"])
    .index("email", ["email"])
    .index("by_tokenIdentifier", ["tokenIdentifier"]),

  companies: defineTable({
    domain: v.string(),
    displayName: v.optional(v.string()),
    memberCount: v.number(),
  })
    .index("by_domain", ["domain"]),

  diffs: defineTable({
    diffId: v.string(),
    authorId: v.id("users"),
    authorHandle: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
    basedOn: v.optional(v.id("diffs")),
    adoptionCount: v.number(),
    activeUserCount: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived")
    ),
    publishedAt: v.optional(v.number()),
  })
    .index("by_authorHandle_and_diffId", ["authorHandle", "diffId"])
    .index("by_authorId", ["authorId"])
    .index("by_status", ["status"])
    .index("by_adoptionCount", ["adoptionCount"]),

  adoptions: defineTable({
    userId: v.id("users"),
    diffId: v.id("diffs"),
    authorHandle: v.string(),
    diffSlug: v.string(),
    adoptedAt: v.number(),
    lastActiveAt: v.optional(v.number()),
    removed: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_diffId", ["diffId"])
    .index("by_userId_and_diffId", ["userId", "diffId"]),

  inviteCodes: defineTable({
    code: v.string(),
    usedBy: v.optional(v.id("users")),
    expiresAt: v.optional(v.number()),
  })
    .index("by_code", ["code"]),

  connectionCodes: defineTable({
    code: v.string(),
    userId: v.id("users"),
    userHandle: v.optional(v.string()),
    expiresAt: v.number(),
    redeemed: v.boolean(),
  })
    .index("by_code", ["code"]),

  cliSessions: defineTable({
    sessionToken: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.number(),
  })
    .index("by_sessionToken", ["sessionToken"])
    .index("by_userId", ["userId"]),

  codeApprovals: defineTable({
    code: v.string(),
    approved: v.boolean(),
    timestamp: v.number(),
  })
    .index("by_code", ["code"]),

  reviewSessions: defineTable({
    sessionCode: v.string(),
    userId: v.id("users"),
    userHandle: v.optional(v.string()),
    diffsData: v.array(v.object({
      diffId: v.string(),
      name: v.string(),
      description: v.string(),
      methodology: v.string(),
      tags: v.array(v.string()),
      roles: v.array(v.string()),
      integrations: v.array(v.string()),
    })),
    visibility: v.optional(v.union(
      v.literal("private"),
      v.literal("colleagues"),
      v.literal("public")
    )),
    loveLetterDraft: v.optional(v.string()),
    makePublic: v.boolean(),
    published: v.boolean(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_sessionCode", ["sessionCode"])
    .index("by_userId", ["userId"]),

  loveLetters: defineTable({
    userId: v.id("users"),
    handle: v.string(),
    displayName: v.string(),
    photoUrl: v.optional(v.string()),
    role: v.optional(v.string()),
    function_: v.optional(v.string()),
    seniority: v.optional(v.string()),
    company: v.optional(v.string()),
    text: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("published"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
    hasDiffs: v.boolean(),
    diffSlugs: v.optional(v.array(v.string())),
  })
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_userId", ["userId"])
    .index("by_function", ["function_"]),
});
